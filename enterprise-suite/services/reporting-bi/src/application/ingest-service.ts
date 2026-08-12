/**
 * Fact ingest.
 *
 * The pipeline for one event:
 *
 *   1. already seen?      -> duplicate, skip (idempotent by source eventId)
 *   2. mapping known?     -> no: dead-letter with reason `no-mapping`
 *   3. mapping returns null -> recognised, nothing to record
 *   4. mapping throws     -> dead-letter with reason `mapping-failed`
 *   5. cube declared?     -> validate dimensions against the cube schema
 *   6. append facts, advance the watermark
 *
 * Idempotency is non-negotiable: an at-least-once bus will redeliver, and a
 * warehouse that double-counts a redelivered order is worse than one that is
 * an hour behind.
 *
 * Batch semantics are per-event, not all-or-nothing. One malformed payload
 * in a batch of a thousand must not block the other 999 — it is recorded and
 * the rest go in.
 */
import {
  brand,
  envelope,
  type EventEnvelope,
  type IsoDateTime,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { CubeDefinition } from "../domain/cube.js";
import { IngestError } from "../domain/errors.js";
import { ReportingEventTypes, type FactsIngestedPayload } from "../domain/events.js";
import {
  createFact,
  deadLetter,
  sourceContextOf,
  UNKNOWN_MEMBER,
  type DeadLetterReason,
  type DeadLetterRecord,
  type FactRecord,
  type IngestWatermark,
} from "../domain/fact.js";
import {
  fromEnvelope,
  type FactDraft,
  type MappingRegistry,
  type SourceEvent,
} from "../domain/ingest.js";
import type {
  CubeRepository,
  DeadLetterRepository,
  FactRepository,
  WatermarkRepository,
} from "../domain/repositories.js";
import type { Clock, Outbox } from "./ports.js";

export interface IngestResult {
  readonly received: number;
  readonly ingested: number;
  readonly factsWritten: number;
  readonly duplicates: number;
  /** Recognised events that intentionally produce no facts. */
  readonly ignored: number;
  readonly rejected: number;
  readonly deadLetters: readonly DeadLetterRecord[];
  readonly cubes: readonly string[];
  readonly watermarks: readonly IngestWatermark[];
}

export class IngestService {
  constructor(
    private readonly facts: FactRepository,
    private readonly cubes: CubeRepository,
    private readonly deadLetters: DeadLetterRepository,
    private readonly watermarks: WatermarkRepository,
    private readonly registry: MappingRegistry,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
  ) {}

  /** Ingests events already shaped as shared-kernel envelopes. */
  async ingestEnvelopes(
    ctx: TenantContext,
    events: readonly EventEnvelope[],
  ): Promise<IngestResult> {
    return this.ingest(ctx, events.map(fromEnvelope));
  }

  async ingest(ctx: TenantContext, events: readonly SourceEvent[]): Promise<IngestResult> {
    const ingestedAt = this.clock.now();
    const cubeCache = new Map<string, CubeDefinition | null>();
    const pendingFacts: FactRecord[] = [];
    const records: DeadLetterRecord[] = [];
    const touchedCubes = new Set<string>();
    const progress = new Map<string, { count: number; facts: number; event: SourceEvent }>();

    let ingested = 0;
    let duplicates = 0;
    let ignored = 0;
    const seenInBatch = new Set<Ulid>();

    for (const event of events) {
      if (event.tenantId !== ctx.tenantId) {
        records.push(
          await this.reject(ctx.tenantId, event, "invalid-payload", `event belongs to tenant ${event.tenantId}`),
        );
        continue;
      }
      if (seenInBatch.has(event.eventId) || (await this.facts.hasEvent(ctx.tenantId, event.eventId))) {
        duplicates += 1;
        continue;
      }

      const mapping = this.registry.find(event.eventType);
      if (!mapping) {
        records.push(
          await this.reject(ctx.tenantId, event, "no-mapping", `no fact mapping for '${event.eventType}'`),
        );
        continue;
      }

      let drafts: readonly FactDraft[];
      try {
        const produced = mapping.map(event, { ingestedAt });
        drafts = produced === null ? [] : Array.isArray(produced) ? produced : [produced as FactDraft];
      } catch (error) {
        records.push(
          await this.reject(
            ctx.tenantId,
            event,
            "mapping-failed",
            error instanceof Error ? error.message : String(error),
          ),
        );
        continue;
      }

      if (drafts.length === 0) {
        ignored += 1;
        seenInBatch.add(event.eventId);
        continue;
      }

      let failed: string | null = null;
      const eventFacts: FactRecord[] = [];
      for (const draft of drafts) {
        const cube = await this.loadCube(ctx.tenantId, draft.cube, cubeCache);
        if (!cube) {
          failed = `cube '${draft.cube}' is not defined in this tenant`;
          break;
        }
        try {
          this.assertDraftMatchesCube(draft, cube);
          eventFacts.push(
            createFact({
              tenantId: ctx.tenantId,
              cube: draft.cube,
              occurredAt: draft.occurredAt ?? event.occurredAt,
              dimensions: draft.dimensions,
              measures: draft.measures,
              currency: draft.currency,
              source: {
                eventId: event.eventId,
                eventType: event.eventType,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                ingestedAt,
                mappingVersion: mapping.version,
              },
            }),
          );
        } catch (error) {
          failed = error instanceof Error ? error.message : String(error);
          break;
        }
      }

      if (failed) {
        records.push(await this.reject(ctx.tenantId, event, "invalid-payload", failed));
        continue;
      }

      pendingFacts.push(...eventFacts);
      for (const fact of eventFacts) touchedCubes.add(fact.cube);
      seenInBatch.add(event.eventId);
      ingested += 1;

      const source = sourceContextOf(event.eventType);
      const current = progress.get(source);
      const isLater = !current || event.occurredAt >= current.event.occurredAt;
      progress.set(source, {
        count: (current?.count ?? 0) + 1,
        facts: (current?.facts ?? 0) + eventFacts.length,
        event: isLater ? event : current!.event,
      });
    }

    if (pendingFacts.length > 0) await this.facts.append(pendingFacts);

    const watermarks = await this.advanceWatermarks(ctx.tenantId, progress, ingestedAt);
    await this.publishSummary(ctx.tenantId, {
      progress,
      watermarks,
      cubes: touchedCubes,
      factCount: pendingFacts.length,
      duplicates,
      rejected: records.length,
    });

    return {
      received: events.length,
      ingested,
      factsWritten: pendingFacts.length,
      duplicates,
      ignored,
      rejected: records.length,
      deadLetters: records,
      cubes: [...touchedCubes].sort(),
      watermarks,
    };
  }

  async listDeadLetters(
    ctx: TenantContext,
    filter?: { reason?: string; eventType?: string; limit?: number },
  ): Promise<DeadLetterRecord[]> {
    return this.deadLetters.list(ctx.tenantId, filter);
  }

  async listWatermarks(ctx: TenantContext): Promise<IngestWatermark[]> {
    return this.watermarks.list(ctx.tenantId);
  }

  /** Event types this deployment knows how to project. */
  supportedEventTypes(): string[] {
    return this.registry.eventTypes();
  }

  /**
   * Drops facts older than a cube's retention window. Returns the number of
   * rows removed so a scheduler can log how much it reclaimed.
   */
  async applyRetention(ctx: TenantContext, cubeName: string): Promise<number> {
    const cube = await this.cubes.findByName(ctx.tenantId, cubeName);
    if (!cube || cube.retentionDays === 0) return 0;
    const cutoff = brand<string, "IsoDateTime">(
      new Date(new Date(this.clock.now()).getTime() - cube.retentionDays * 86_400_000).toISOString(),
    );
    const purged = await this.facts.purgeBefore(ctx.tenantId, cubeName, cutoff);
    if (purged > 0) {
      await this.outbox.append([
        envelope({
          eventType: ReportingEventTypes.FactsPurged,
          aggregateType: "Cube",
          aggregateId: cube.id,
          tenantId: ctx.tenantId,
          payload: { cube: cubeName, purged, before: cutoff },
        }),
      ]);
    }
    return purged;
  }

  private async loadCube(
    tenantId: TenantId,
    name: string,
    cache: Map<string, CubeDefinition | null>,
  ): Promise<CubeDefinition | null> {
    if (cache.has(name)) return cache.get(name)!;
    const cube = await this.cubes.findByName(tenantId, name);
    cache.set(name, cube);
    return cube;
  }

  /**
   * Ingest-time schema check. Unknown dimension keys are a mapping bug, and
   * silently storing them would produce a column no query can ever reach.
   */
  private assertDraftMatchesCube(draft: FactDraft, cube: CubeDefinition): void {
    for (const key of Object.keys(draft.dimensions)) {
      if (!cube.hasDimension(key)) {
        throw new IngestError(`cube '${cube.name}' does not declare dimension '${key}'`, {
          declared: cube.dimensions.map((d) => d.factKey),
        });
      }
    }
    for (const key of Object.keys(draft.measures)) {
      if (!cube.hasMeasureField(key)) {
        throw new IngestError(`cube '${cube.name}' does not declare measure '${key}'`, {
          declared: cube.measureFields.map((m) => m.field),
        });
      }
    }
    for (const required of cube.requiredDimensions()) {
      const value = draft.dimensions[required];
      if (value === undefined || value === null || value === "" || value === UNKNOWN_MEMBER) {
        throw new IngestError(`cube '${cube.name}' requires dimension '${required}'`);
      }
    }
  }

  private async reject(
    tenantId: TenantId,
    event: SourceEvent,
    reason: DeadLetterReason,
    message: string,
  ): Promise<DeadLetterRecord> {
    const record = deadLetter({
      tenantId,
      eventId: event.eventId,
      eventType: event.eventType,
      reason,
      message,
      payload: event.payload,
      recordedAt: this.clock.now(),
    });
    await this.deadLetters.append(record);
    await this.outbox.append([
      envelope({
        eventType: ReportingEventTypes.FactsRejected,
        aggregateType: "IngestBatch",
        aggregateId: event.eventId,
        tenantId,
        payload: {
          source: sourceContextOf(event.eventType),
          reason,
          eventType: event.eventType,
          eventId: event.eventId,
          message,
        },
      }),
    ]);
    return record;
  }

  private async advanceWatermarks(
    tenantId: TenantId,
    progress: Map<string, { count: number; facts: number; event: SourceEvent }>,
    ingestedAt: IsoDateTime,
  ): Promise<IngestWatermark[]> {
    const updated: IngestWatermark[] = [];
    for (const [source, entry] of progress) {
      const existing = await this.watermarks.get(tenantId, source);
      // Out-of-order delivery must not rewind the freshness indicator.
      const isNewer = !existing || entry.event.occurredAt >= existing.lastOccurredAt;
      const watermark: IngestWatermark = {
        tenantId,
        source,
        lastEventId: isNewer ? entry.event.eventId : existing!.lastEventId,
        lastEventType: isNewer ? entry.event.eventType : existing!.lastEventType,
        lastOccurredAt: isNewer ? entry.event.occurredAt : existing!.lastOccurredAt,
        lastIngestedAt: ingestedAt,
        eventCount: (existing?.eventCount ?? 0) + entry.count,
        factCount: (existing?.factCount ?? 0) + entry.facts,
      };
      await this.watermarks.upsert(watermark);
      updated.push(watermark);
    }
    return updated;
  }

  private async publishSummary(
    tenantId: TenantId,
    input: {
      progress: Map<string, { count: number; facts: number; event: SourceEvent }>;
      watermarks: readonly IngestWatermark[];
      cubes: ReadonlySet<string>;
      factCount: number;
      duplicates: number;
      rejected: number;
    },
  ): Promise<void> {
    if (input.progress.size === 0) return;
    const events: EventEnvelope[] = [];
    for (const [source, entry] of input.progress) {
      const watermark = input.watermarks.find((w) => w.source === source);
      const payload: FactsIngestedPayload = {
        cube: [...input.cubes].sort().join(","),
        source,
        eventCount: entry.count,
        factCount: entry.facts,
        duplicateCount: input.duplicates,
        rejectedCount: input.rejected,
        watermark: watermark?.lastOccurredAt ?? entry.event.occurredAt,
      };
      events.push(
        envelope({
          eventType: ReportingEventTypes.FactsIngested,
          aggregateType: "IngestBatch",
          aggregateId: entry.event.eventId,
          tenantId,
          payload,
        }),
      );
    }
    await this.outbox.append(events);
  }
}

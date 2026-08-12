/**
 * Fact ingest: turning other contexts' domain events into warehouse rows.
 *
 * Reporting subscribes to the event stream rather than reading anyone's
 * tables, so the coupling is to published event *payloads* — treated here as
 * untrusted, loosely-typed DTOs. A mapping declares which event type it
 * consumes, which cube it writes, and how to project payload fields onto
 * dimensions and measures.
 *
 * Three outcomes are possible and all three are meaningful:
 *
 *   FactDraft[]  facts to store
 *   []  or null  a recognised event that intentionally records nothing
 *   throw        a malformed payload, which becomes a dead-letter record
 *
 * Mappings are versioned. When a projection changes, bumping `version` makes
 * facts produced before and after the change distinguishable, which is what
 * a backfill needs to clean up after itself.
 */
import type { EventEnvelope, IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { brand } from "@enterprise-suite/shared-kernel";
import { IngestError } from "./errors.js";

/** A domain event as it arrives from the bus or the HTTP ingest endpoint. */
export interface SourceEvent<TPayload = unknown> {
  readonly eventId: Ulid;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: Ulid;
  readonly tenantId: TenantId;
  readonly occurredAt: IsoDateTime;
  readonly schemaVersion: number;
  readonly payload: TPayload;
  readonly correlationId?: Ulid;
}

export function fromEnvelope<T>(event: EventEnvelope<T>): SourceEvent<T> {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    tenantId: event.tenantId,
    occurredAt: event.occurredAt,
    schemaVersion: event.schemaVersion,
    payload: event.payload,
    correlationId: event.correlationId,
  };
}

/** Validates an inbound JSON envelope from the HTTP ingest endpoint. */
export function parseSourceEvent(raw: unknown, fallbackTenant?: TenantId): SourceEvent {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new IngestError("event must be a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const requireText = (key: string): string => {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) {
      throw new IngestError(`event.${key} is required`, { received: value });
    }
    return value;
  };

  const tenant = typeof record.tenantId === "string" && record.tenantId ? record.tenantId : fallbackTenant;
  if (!tenant) throw new IngestError("event.tenantId is required");

  const occurredAtRaw = typeof record.occurredAt === "string" ? record.occurredAt : undefined;
  if (!occurredAtRaw) throw new IngestError("event.occurredAt is required");
  const occurredAt = new Date(occurredAtRaw);
  if (Number.isNaN(occurredAt.getTime())) {
    throw new IngestError(`event.occurredAt is not a valid instant: ${occurredAtRaw}`);
  }

  return {
    eventId: brand<string, "Ulid">(requireText("eventId")),
    eventType: requireText("eventType"),
    aggregateType: typeof record.aggregateType === "string" ? record.aggregateType : "unknown",
    aggregateId: brand<string, "Ulid">(
      typeof record.aggregateId === "string" ? record.aggregateId : requireText("eventId"),
    ),
    tenantId: brand<string, "TenantId">(tenant),
    occurredAt: brand<string, "IsoDateTime">(occurredAt.toISOString()),
    schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
    payload: record.payload ?? {},
    correlationId:
      typeof record.correlationId === "string" ? brand<string, "Ulid">(record.correlationId) : undefined,
  };
}

export interface MappingContext {
  readonly ingestedAt: IsoDateTime;
}

/** What a mapping produces: a fact minus the bookkeeping ingest adds. */
export interface FactDraft {
  readonly cube: string;
  readonly dimensions: Readonly<Record<string, string | number | boolean | null | undefined>>;
  readonly measures: Readonly<Record<string, number>>;
  /** Defaults to the event's own instant. */
  readonly occurredAt?: IsoDateTime;
  readonly currency?: string;
}

export interface FactMapping {
  readonly eventType: string;
  readonly cube: string;
  readonly version: number;
  readonly description?: string;
  map(event: SourceEvent, ctx: MappingContext): FactDraft | readonly FactDraft[] | null;
}

export class MappingRegistry {
  private readonly byEventType = new Map<string, FactMapping>();

  register(mapping: FactMapping): this {
    if (this.byEventType.has(mapping.eventType)) {
      throw new IngestError(`a mapping for '${mapping.eventType}' is already registered`);
    }
    this.byEventType.set(mapping.eventType, mapping);
    return this;
  }

  registerAll(mappings: Iterable<FactMapping>): this {
    for (const mapping of mappings) this.register(mapping);
    return this;
  }

  /** Replaces an existing mapping — used when a tenant overrides a default. */
  override(mapping: FactMapping): this {
    this.byEventType.set(mapping.eventType, mapping);
    return this;
  }

  find(eventType: string): FactMapping | undefined {
    return this.byEventType.get(eventType);
  }

  eventTypes(): string[] {
    return [...this.byEventType.keys()].sort();
  }

  all(): FactMapping[] {
    return [...this.byEventType.values()];
  }

  forCube(cube: string): FactMapping[] {
    return this.all().filter((mapping) => mapping.cube === cube);
  }

  cubes(): string[] {
    return [...new Set(this.all().map((m) => m.cube))].sort();
  }
}

// ---------------------------------------------------------------------------
// Payload accessors
//
// Upstream payloads are plain JSON of varying shape (some contexts nest Money
// objects, some flatten to `*_minor` numbers). These helpers keep mappings
// declarative and give a precise error when a contract changes upstream.
// ---------------------------------------------------------------------------

function walk(payload: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, payload);
}

export function optionalString(payload: unknown, path: string): string | undefined {
  const value = walk(payload, path);
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "string" ? value : String(value);
}

export function requiredString(payload: unknown, path: string): string {
  const value = optionalString(payload, path);
  if (value === undefined) {
    throw new IngestError(`payload.${path} is required`, { path });
  }
  return value;
}

export function optionalNumber(payload: unknown, path: string): number | undefined {
  const value = walk(payload, path);
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new IngestError(`payload.${path} must be a finite number`, { path, received: value });
  }
  return parsed;
}

export function numberOr(payload: unknown, path: string, fallback: number): number {
  return optionalNumber(payload, path) ?? fallback;
}

export function requiredNumber(payload: unknown, path: string): number {
  const value = optionalNumber(payload, path);
  if (value === undefined) {
    throw new IngestError(`payload.${path} is required`, { path });
  }
  return value;
}

export function optionalBoolean(payload: unknown, path: string): boolean | undefined {
  const value = walk(payload, path);
  if (value === undefined || value === null) return undefined;
  return Boolean(value);
}

export function arrayField(payload: unknown, path: string): readonly unknown[] {
  const value = walk(payload, path);
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new IngestError(`payload.${path} must be an array`, { path });
  }
  return value;
}

/**
 * Reads a shared-kernel Money value, tolerating both the nested object form
 * (`{amountMinor, currency}`) and the flattened `*_minor` + `currency` form
 * that several contexts publish.
 */
export function moneyMinor(payload: unknown, path: string): { minor: number; currency?: string } {
  const direct = walk(payload, path);
  if (typeof direct === "number") {
    return { minor: direct, currency: optionalString(payload, "currency") };
  }
  if (typeof direct === "object" && direct !== null) {
    return {
      minor: requiredNumber(direct, "amountMinor"),
      currency: optionalString(direct, "currency"),
    };
  }
  throw new IngestError(`payload.${path} is not a money value`, { path });
}

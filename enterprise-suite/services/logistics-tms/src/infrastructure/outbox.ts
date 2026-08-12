import { newId, nowIso, type EventEnvelope, type IsoDateTime, type Ulid } from "@enterprise-suite/shared-kernel";

export type OutboxStatus = "pending" | "published" | "failed";

export interface OutboxRecord {
  readonly outboxId: Ulid;
  readonly envelope: EventEnvelope;
  status: OutboxStatus;
  readonly enqueuedAt: IsoDateTime;
  publishedAt?: IsoDateTime;
  attempts: number;
  lastError?: string;
}

/**
 * Transactional-outbox port. Application services enqueue the events an
 * aggregate raised in the same logical unit of work as the repository save;
 * a relay (here: `drain`) later publishes them to the event bus.
 */
export interface OutboxPort {
  enqueue(events: readonly EventEnvelope[]): void;
  pending(): readonly OutboxRecord[];
  drain(publish: (envelope: EventEnvelope) => Promise<void> | void): Promise<DrainResult>;
}

export interface DrainResult {
  readonly published: number;
  readonly failed: number;
}

export class InMemoryOutbox implements OutboxPort {
  private readonly records: OutboxRecord[] = [];

  enqueue(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      this.records.push({
        outboxId: newId("obx"),
        envelope: event,
        status: "pending",
        enqueuedAt: nowIso(),
        attempts: 0,
      });
    }
  }

  pending(): readonly OutboxRecord[] {
    return this.records.filter((r) => r.status === "pending");
  }

  all(): readonly OutboxRecord[] {
    return this.records;
  }

  /**
   * Publishes pending records in enqueue order. A failing record is marked
   * `failed` (with the error retained) and does not block later records —
   * ordering guarantees hold per aggregate, not across the whole stream.
   */
  async drain(publish: (envelope: EventEnvelope) => Promise<void> | void): Promise<DrainResult> {
    let published = 0;
    let failed = 0;
    for (const record of this.records) {
      if (record.status !== "pending") continue;
      record.attempts += 1;
      try {
        await publish(record.envelope);
        record.status = "published";
        record.publishedAt = nowIso();
        published += 1;
      } catch (error) {
        record.status = "failed";
        record.lastError = error instanceof Error ? error.message : String(error);
        failed += 1;
      }
    }
    return { published, failed };
  }

  /** Requeues failed records (manual retry hook for operators). */
  retryFailed(): number {
    let count = 0;
    for (const record of this.records) {
      if (record.status === "failed") {
        record.status = "pending";
        record.lastError = undefined;
        count += 1;
      }
    }
    return count;
  }
}

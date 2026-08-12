/**
 * In-memory transactional outbox. Application services append events after
 * the repository save; a relay (integration-hub) drains and publishes them.
 */
import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { Outbox } from "../../application/ports.js";

interface OutboxRecord {
  readonly event: EventEnvelope;
  dispatched: boolean;
}

export class InMemoryOutbox implements Outbox {
  private readonly records: OutboxRecord[] = [];

  async append(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) this.records.push({ event, dispatched: false });
  }

  async drain(): Promise<EventEnvelope[]> {
    const pending = this.records.filter((r) => !r.dispatched);
    for (const record of pending) record.dispatched = true;
    return pending.map((r) => r.event);
  }

  async pending(): Promise<readonly EventEnvelope[]> {
    return this.records.filter((r) => !r.dispatched).map((r) => r.event);
  }

  /** Every event ever appended (test/diagnostic helper). */
  all(): readonly EventEnvelope[] {
    return this.records.map((r) => r.event);
  }

  ofType(eventType: string): EventEnvelope[] {
    return this.records.filter((r) => r.event.eventType === eventType).map((r) => r.event);
  }
}

import type { EventEnvelope } from "../../kernel/index.js";
import type { OutboxPort } from "../../application/ports.js";

/**
 * In-memory transactional outbox. Events appended here would be written in
 * the same transaction as the aggregate in the Postgres implementation
 * (see migrations/0008_outbox.sql) and relayed to the event bus by a poller.
 */
export class InMemoryOutbox implements OutboxPort {
  private events: EventEnvelope[] = [];

  append(events: readonly EventEnvelope[]): void {
    this.events.push(...events);
  }

  all(): readonly EventEnvelope[] {
    return [...this.events];
  }

  byType(eventType: string): readonly EventEnvelope[] {
    return this.events.filter((e) => e.eventType === eventType);
  }

  drain(): EventEnvelope[] {
    return this.events.splice(0, this.events.length);
  }
}

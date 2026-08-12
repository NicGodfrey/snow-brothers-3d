import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { EventOutbox } from "../../application/ports.js";

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory transactional outbox. Events are retained (for inspection,
 * projections and tests) and fanned out synchronously to subscribers.
 * A Postgres implementation would insert rows in the same transaction as the
 * aggregate writes and relay them asynchronously.
 */
export class InMemoryOutbox implements EventOutbox {
  private readonly stored: EventEnvelope[] = [];
  private readonly subscribers = new Set<OutboxSubscriber>();

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.stored.push(event);
      for (const subscriber of this.subscribers) {
        subscriber(event);
      }
    }
  }

  subscribe(subscriber: OutboxSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  /** All events published so far (read-only view). */
  get events(): readonly EventEnvelope[] {
    return this.stored;
  }

  eventsOfType(eventType: string): EventEnvelope[] {
    return this.stored.filter((e) => e.eventType === eventType);
  }

  /** Remove and return everything currently stored (used by relays/tests). */
  drain(): EventEnvelope[] {
    return this.stored.splice(0, this.stored.length);
  }
}

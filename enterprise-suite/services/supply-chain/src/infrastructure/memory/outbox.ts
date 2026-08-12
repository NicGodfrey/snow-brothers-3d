import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { OutboxPort } from "../../application/ports.js";

export type OutboxSubscriber = (event: EventEnvelope) => void;

/**
 * In-memory stand-in for the transactional outbox. Events are appended in
 * publish order and fanned out synchronously to subscribers (e.g. the shared
 * event bus adapter, projections, tests).
 */
export class InMemoryOutbox implements OutboxPort {
  private readonly log: EventEnvelope[] = [];
  private readonly subscribers: OutboxSubscriber[] = [];

  async publish(events: readonly EventEnvelope[]): Promise<void> {
    for (const event of events) {
      this.log.push(event);
      for (const subscriber of this.subscribers) subscriber(event);
    }
  }

  subscribe(subscriber: OutboxSubscriber): () => void {
    this.subscribers.push(subscriber);
    return () => {
      const index = this.subscribers.indexOf(subscriber);
      if (index >= 0) this.subscribers.splice(index, 1);
    };
  }

  events(): readonly EventEnvelope[] {
    return this.log;
  }

  eventsOfType(eventType: string): readonly EventEnvelope[] {
    return this.log.filter((e) => e.eventType === eventType);
  }
}

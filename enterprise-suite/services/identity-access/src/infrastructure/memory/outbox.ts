import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { Outbox } from "../../application/ports.js";

export type EventHandler = (event: EventEnvelope) => void;

/**
 * In-memory transactional outbox. Events accumulate until a relay drains them; local
 * subscribers are notified synchronously so tests and in-process projections can react
 * without a broker.
 */
export class InMemoryOutbox implements Outbox {
  private readonly events: EventEnvelope[] = [];
  private readonly handlers = new Map<string, EventHandler[]>();
  private readonly anyHandlers: EventHandler[] = [];
  private published = 0;

  publish(events: readonly EventEnvelope[]): void {
    for (const event of events) {
      this.events.push(event);
      this.published += 1;
      for (const handler of this.handlers.get(event.eventType) ?? []) handler(event);
      for (const handler of this.anyHandlers) handler(event);
    }
  }

  /** Subscribes to one event type, or to everything when `eventType` is "*". */
  on(eventType: string, handler: EventHandler): () => void {
    if (eventType === "*") {
      this.anyHandlers.push(handler);
      return () => {
        const index = this.anyHandlers.indexOf(handler);
        if (index >= 0) this.anyHandlers.splice(index, 1);
      };
    }
    const bucket = this.handlers.get(eventType) ?? [];
    bucket.push(handler);
    this.handlers.set(eventType, bucket);
    return () => {
      const index = bucket.indexOf(handler);
      if (index >= 0) bucket.splice(index, 1);
    };
  }

  pending(): readonly EventEnvelope[] {
    return [...this.events];
  }

  drain(): readonly EventEnvelope[] {
    return this.events.splice(0, this.events.length);
  }

  size(): number {
    return this.events.length;
  }

  totalPublished(): number {
    return this.published;
  }

  ofType(eventType: string): readonly EventEnvelope[] {
    return this.events.filter((event) => event.eventType === eventType);
  }

  clear(): void {
    this.events.length = 0;
  }
}

import type { EventEnvelope, TenantId } from "@enterprise-suite/shared-kernel";

export type OutboxSubscriber = (event: EventEnvelope) => void;

export interface EventOutbox {
  publish(event: EventEnvelope): void;
  publishAll(events: EventEnvelope[]): void;
  subscribe(subscriber: OutboxSubscriber): () => void;
  list(tenantId?: TenantId, eventType?: string): EventEnvelope[];
}

/**
 * Transactional-outbox stand-in: events are appended in publish order and
 * fanned out synchronously to local subscribers. Integration-hub is expected
 * to drain the same log asynchronously in the real deployment.
 */
export class InMemoryOutbox implements EventOutbox {
  private readonly log: EventEnvelope[] = [];
  private readonly subscribers = new Set<OutboxSubscriber>();

  publish(event: EventEnvelope): void {
    this.log.push(event);
    for (const subscriber of this.subscribers) {
      subscriber(event);
    }
  }

  publishAll(events: EventEnvelope[]): void {
    for (const event of events) this.publish(event);
  }

  subscribe(subscriber: OutboxSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => this.subscribers.delete(subscriber);
  }

  list(tenantId?: TenantId, eventType?: string): EventEnvelope[] {
    return this.log
      .filter((e) => !tenantId || e.tenantId === tenantId)
      .filter((e) => !eventType || e.eventType === eventType);
  }
}

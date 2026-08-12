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
export declare class InMemoryOutbox implements EventOutbox {
    private readonly log;
    private readonly subscribers;
    publish(event: EventEnvelope): void;
    publishAll(events: EventEnvelope[]): void;
    subscribe(subscriber: OutboxSubscriber): () => void;
    list(tenantId?: TenantId, eventType?: string): EventEnvelope[];
}
//# sourceMappingURL=outbox.d.ts.map
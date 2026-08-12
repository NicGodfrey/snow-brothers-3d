import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { OutboxPort } from "../../application/ports.js";
export type OutboxSubscriber = (event: EventEnvelope) => void;
/**
 * In-memory stand-in for the transactional outbox. Events are appended in
 * publish order and fanned out synchronously to subscribers (e.g. the shared
 * event bus adapter, projections, tests).
 */
export declare class InMemoryOutbox implements OutboxPort {
    private readonly log;
    private readonly subscribers;
    publish(events: readonly EventEnvelope[]): Promise<void>;
    subscribe(subscriber: OutboxSubscriber): () => void;
    events(): readonly EventEnvelope[];
    eventsOfType(eventType: string): readonly EventEnvelope[];
}
//# sourceMappingURL=outbox.d.ts.map
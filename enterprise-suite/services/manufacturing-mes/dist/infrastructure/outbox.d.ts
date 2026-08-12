import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { EventPublisher } from "../application/ports.js";
export type OutboxSubscriber = (event: EventEnvelope) => void;
/**
 * In-memory stand-in for a transactional outbox. Services publish events
 * after saving aggregates; the outbox keeps them (for polling relays /
 * integration-hub) and fans them out to local subscribers synchronously.
 *
 * The Postgres version writes rows in the aggregate's transaction and a
 * relay marks them dispatched — see migrations/0009_outbox.sql.
 */
export declare class InMemoryOutbox implements EventPublisher {
    private readonly entries;
    private readonly subscribers;
    publish(events: readonly EventEnvelope[]): Promise<void>;
    /** Subscribe to an exact eventType or a prefix like "mes.work-order.". */
    subscribe(pattern: string, handler: OutboxSubscriber): () => void;
    /** All stored events, oldest first. */
    all(): readonly EventEnvelope[];
    ofType(eventType: string): EventEnvelope[];
    /** Remove and return everything — what a dispatch relay would do. */
    drain(): EventEnvelope[];
}
//# sourceMappingURL=outbox.d.ts.map
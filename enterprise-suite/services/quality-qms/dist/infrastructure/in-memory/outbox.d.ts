/**
 * In-memory transactional outbox. Events are appended by application
 * services after the aggregate save; `drain()` hands them to a relay
 * (integration-hub) and marks them dispatched. Ordering is append order.
 */
import type { EventEnvelope } from "@enterprise-suite/shared-kernel";
import type { Outbox } from "../../application/ports.js";
export declare class InMemoryOutbox implements Outbox {
    private readonly records;
    append(events: readonly EventEnvelope[]): Promise<void>;
    drain(): Promise<EventEnvelope[]>;
    pending(): Promise<readonly EventEnvelope[]>;
    /** All events ever appended (test/diagnostic helper). */
    all(): readonly EventEnvelope[];
}
//# sourceMappingURL=outbox.d.ts.map
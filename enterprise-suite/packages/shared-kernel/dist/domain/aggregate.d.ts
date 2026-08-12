import type { EventEnvelope } from "../events/envelope.js";
import { Entity } from "./entity.js";
export declare abstract class AggregateRoot<TProps extends object> extends Entity<TProps> {
    private readonly pending;
    protected raise(event: EventEnvelope): void;
    pullEvents(): EventEnvelope[];
}
//# sourceMappingURL=aggregate.d.ts.map
import { Entity } from "./entity.js";
export class AggregateRoot extends Entity {
    pending = [];
    raise(event) {
        this.pending.push(event);
        this.touch();
    }
    pullEvents() {
        return this.pending.splice(0, this.pending.length);
    }
}
//# sourceMappingURL=aggregate.js.map
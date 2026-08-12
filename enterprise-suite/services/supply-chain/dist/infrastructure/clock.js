import { fromUtcDate } from "../domain/calendar.js";
export class SystemClock {
    now() {
        return new Date();
    }
    today() {
        return fromUtcDate(this.now());
    }
}
/** Deterministic clock for tests and reproducible planning runs. */
export class FixedClock {
    current;
    constructor(current) {
        this.current = current;
    }
    now() {
        return new Date(this.current.getTime());
    }
    today() {
        return fromUtcDate(this.current);
    }
    advanceDays(days) {
        this.current = new Date(this.current.getTime() + days * 86_400_000);
    }
}
//# sourceMappingURL=clock.js.map
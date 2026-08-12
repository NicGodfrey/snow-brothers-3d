import { nowIso } from "@enterprise-suite/shared-kernel";
export class SystemClock {
    now() {
        return nowIso();
    }
}
/** Deterministic clock for tests: starts at a fixed instant, can advance. */
export class FixedClock {
    current;
    constructor(startAt = "2026-08-12T09:00:00.000Z") {
        this.current = new Date(startAt);
    }
    now() {
        return this.current.toISOString();
    }
    advance(ms) {
        this.current = new Date(this.current.getTime() + ms);
    }
    set(instant) {
        this.current = new Date(instant);
    }
}
//# sourceMappingURL=clock.js.map
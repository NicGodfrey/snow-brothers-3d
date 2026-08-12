export class SystemClock {
    now() {
        return new Date();
    }
    today() {
        return this.now().toISOString().slice(0, 10);
    }
}
/** Deterministic clock for tests and reproducible scheduling scenarios. */
export class FixedClock {
    current;
    constructor(current) {
        this.current = current;
    }
    now() {
        return new Date(this.current.getTime());
    }
    today() {
        return this.current.toISOString().slice(0, 10);
    }
    set(next) {
        this.current = next;
    }
    advanceDays(days) {
        this.current = new Date(this.current.getTime() + days * 86_400_000);
    }
}
//# sourceMappingURL=clock.js.map
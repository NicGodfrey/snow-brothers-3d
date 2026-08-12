import type { Clock } from "../application/ports.js";
export declare class SystemClock implements Clock {
    now(): Date;
    today(): string;
}
/** Deterministic clock for tests and reproducible scheduling scenarios. */
export declare class FixedClock implements Clock {
    private current;
    constructor(current: Date);
    now(): Date;
    today(): string;
    set(next: Date): void;
    advanceDays(days: number): void;
}
//# sourceMappingURL=clock.d.ts.map
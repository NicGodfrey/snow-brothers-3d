import type { IsoDate } from "../domain/types.js";
import type { Clock } from "../application/ports.js";
export declare class SystemClock implements Clock {
    now(): Date;
    today(): IsoDate;
}
/** Deterministic clock for tests and reproducible planning runs. */
export declare class FixedClock implements Clock {
    private current;
    constructor(current: Date);
    now(): Date;
    today(): IsoDate;
    advanceDays(days: number): void;
}
//# sourceMappingURL=clock.d.ts.map
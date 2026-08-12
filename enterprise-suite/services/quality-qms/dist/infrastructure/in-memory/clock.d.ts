import { type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { Clock } from "../../application/ports.js";
export declare class SystemClock implements Clock {
    now(): IsoDateTime;
}
/** Deterministic clock for tests: starts at a fixed instant, can advance. */
export declare class FixedClock implements Clock {
    private current;
    constructor(startAt?: string | Date);
    now(): IsoDateTime;
    advance(ms: number): void;
    set(instant: string | Date): void;
}
//# sourceMappingURL=clock.d.ts.map
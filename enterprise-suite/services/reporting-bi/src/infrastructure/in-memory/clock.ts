import { nowIso, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { Clock } from "../../application/ports.js";

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }
}

/** Deterministic clock for tests: fixed start, explicit advance. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(startAt: string | Date = "2026-08-12T09:00:00.000Z") {
    this.current = new Date(startAt);
  }

  now(): IsoDateTime {
    return this.current.toISOString() as IsoDateTime;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceDays(days: number): void {
    this.advance(days * 86_400_000);
  }

  set(instant: string | Date): void {
    this.current = new Date(instant);
  }
}

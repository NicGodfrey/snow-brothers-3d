import { nowIso, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { Clock } from "../../application/ports.js";

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }
}

/** Deterministic clock for tests: starts at a fixed instant, can advance. */
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

  set(instant: string | Date): void {
    this.current = new Date(instant);
  }
}

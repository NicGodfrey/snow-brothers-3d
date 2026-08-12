import { nowIso, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { isoOf } from "../../domain/time.js";
import type { Clock } from "../../application/ports.js";

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }
}

/**
 * Deterministic clock. Backoff, lease expiry and key TTLs are all time-driven,
 * so tests advance this instead of sleeping.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(startAt: string | Date = "2026-08-12T09:00:00.000Z") {
    this.current = new Date(startAt);
  }

  now(): IsoDateTime {
    return isoOf(this.current);
  }

  advance(ms: number): this {
    this.current = new Date(this.current.getTime() + ms);
    return this;
  }

  advanceSeconds(seconds: number): this {
    return this.advance(seconds * 1000);
  }

  advanceMinutes(minutes: number): this {
    return this.advance(minutes * 60_000);
  }

  set(instant: string | Date): this {
    this.current = new Date(instant);
    return this;
  }
}

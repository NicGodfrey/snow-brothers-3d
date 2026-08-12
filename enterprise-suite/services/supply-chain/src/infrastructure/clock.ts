import { fromUtcDate } from "../domain/calendar.js";
import type { IsoDate } from "../domain/types.js";
import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): IsoDate {
    return fromUtcDate(this.now());
  }
}

/** Deterministic clock for tests and reproducible planning runs. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  today(): IsoDate {
    return fromUtcDate(this.current);
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
}

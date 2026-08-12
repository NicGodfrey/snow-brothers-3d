import { brand, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): IsoDateTime {
    return brand<string, "IsoDateTime">(new Date().toISOString());
  }
}

/**
 * Deterministic clock for tests, demos, and replaying journeys: starts at a
 * fixed instant and only moves when told to.
 */
export class FixedClock implements Clock {
  private current: Date;

  constructor(startAt: string | Date) {
    this.current = new Date(startAt);
    if (Number.isNaN(this.current.getTime())) {
      throw new Error(`FixedClock: invalid start instant: ${String(startAt)}`);
    }
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  nowIso(): IsoDateTime {
    return brand<string, "IsoDateTime">(this.current.toISOString());
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }

  set(at: string | Date): void {
    this.current = new Date(at);
  }
}

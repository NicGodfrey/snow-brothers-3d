import { brand, nowIso, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }

  epochMs(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests and fixtures; time only moves when told to. */
export class FixedClock implements Clock {
  private currentMs: number;

  constructor(start: string | number = "2026-01-15T09:00:00.000Z") {
    this.currentMs = typeof start === "number" ? start : Date.parse(start);
  }

  now(): IsoDateTime {
    return brand<string, "IsoDateTime">(new Date(this.currentMs).toISOString());
  }

  epochMs(): number {
    return this.currentMs;
  }

  advanceSeconds(seconds: number): this {
    this.currentMs += seconds * 1000;
    return this;
  }

  advanceMinutes(minutes: number): this {
    return this.advanceSeconds(minutes * 60);
  }

  advanceHours(hours: number): this {
    return this.advanceSeconds(hours * 3600);
  }

  advanceDays(days: number): this {
    return this.advanceSeconds(days * 86_400);
  }

  set(at: string): this {
    this.currentMs = Date.parse(at);
    return this;
  }
}

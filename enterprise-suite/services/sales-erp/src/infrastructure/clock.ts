import { brand, nowIso, type IsoDate, type IsoDateTime } from "../kernel/index.js";
import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  now(): IsoDateTime {
    return nowIso();
  }

  today(): IsoDate {
    return brand<string, "IsoDate">(new Date().toISOString().slice(0, 10));
  }
}

/** Deterministic clock for tests and validity/expiry scenarios. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(isoDateTime: string) {
    this.current = new Date(isoDateTime);
  }

  now(): IsoDateTime {
    return brand<string, "IsoDateTime">(this.current.toISOString());
  }

  today(): IsoDate {
    return brand<string, "IsoDate">(this.current.toISOString().slice(0, 10));
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }

  set(isoDateTime: string): void {
    this.current = new Date(isoDateTime);
  }
}

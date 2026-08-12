import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
  nowMs(): number {
    return Date.now();
  }
}

/** Deterministic clock for tests; `advance` moves both views forward. */
export class FixedClock implements Clock {
  private ms: number;

  constructor(iso = "2026-01-01T00:00:00.000Z") {
    this.ms = Date.parse(iso);
  }

  now(): string {
    return new Date(this.ms).toISOString();
  }

  nowMs(): number {
    return this.ms;
  }

  advance(ms: number): this {
    this.ms += ms;
    return this;
  }
}

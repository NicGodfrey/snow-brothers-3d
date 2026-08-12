import type { Clock } from "../application/ports.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  today(): string {
    return this.now().toISOString().slice(0, 10);
  }
}

/** Deterministic clock for tests and reproducible scheduling scenarios. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current.getTime());
  }

  today(): string {
    return this.current.toISOString().slice(0, 10);
  }

  set(next: Date): void {
    this.current = next;
  }

  advanceDays(days: number): void {
    this.current = new Date(this.current.getTime() + days * 86_400_000);
  }
}

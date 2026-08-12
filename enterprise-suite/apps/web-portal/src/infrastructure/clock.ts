/** Clock seam: tests pin time, production uses the system clock. */
export interface Clock {
  now(): string;
  epochMs(): number;
}

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
  epochMs(): number {
    return Date.now();
  }
}

export class FixedClock implements Clock {
  private current: number;

  constructor(iso = "2026-03-02T09:00:00.000Z") {
    this.current = Date.parse(iso);
  }

  now(): string {
    return new Date(this.current).toISOString();
  }

  epochMs(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

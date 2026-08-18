export class Semaphore {
  private readonly waiters: Array<() => void> = [];
  private current = 0;
  peak = 0;

  constructor(readonly max: number) {
    if (max < 1) throw new Error("Semaphore max must be >= 1");
  }

  get inFlight(): number {
    return this.current;
  }

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current += 1;
      this.peak = Math.max(this.peak, this.current);
      return;
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      this.peak = Math.max(this.peak, this.current);
      next();
      return;
    }
    this.current = Math.max(0, this.current - 1);
  }
}

export class KeyLock {
  private readonly locks = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(key, current);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === current) this.locks.delete(key);
    }
  }
}

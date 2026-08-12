/**
 * Delay scheduling port. Retry backoff goes through a Scheduler so tests can
 * run virtual time instead of sleeping.
 */

export type CancelScheduled = () => void;

export interface Scheduler {
  schedule(delayMs: number, fn: () => void): CancelScheduled;
}

/** Production scheduler: unref'd timers so a pending retry never pins the process. */
export class TimerScheduler implements Scheduler {
  schedule(delayMs: number, fn: () => void): CancelScheduled {
    const timer = setTimeout(fn, Math.max(0, delayMs));
    if (typeof timer.unref === "function") timer.unref();
    return () => clearTimeout(timer);
  }
}

/**
 * Runs callbacks on the microtask queue, ignoring the requested delay but
 * recording it. Keeps retry-heavy tests fast while still asserting backoff.
 */
export class ImmediateScheduler implements Scheduler {
  readonly observedDelays: number[] = [];

  schedule(delayMs: number, fn: () => void): CancelScheduled {
    this.observedDelays.push(delayMs);
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) fn();
    });
    return () => {
      cancelled = true;
    };
  }
}

interface ManualTask {
  readonly at: number;
  readonly seq: number;
  readonly fn: () => void;
  cancelled: boolean;
}

/** Virtual-clock scheduler: nothing runs until time is advanced explicitly. */
export class ManualScheduler implements Scheduler {
  private tasks: ManualTask[] = [];
  private clock = 0;
  private seq = 0;

  get now(): number {
    return this.clock;
  }

  get pending(): number {
    return this.tasks.filter((task) => !task.cancelled).length;
  }

  /** Delays of the still-pending tasks, relative to the current virtual time. */
  pendingDelays(): number[] {
    return this.tasks.filter((t) => !t.cancelled).map((t) => t.at - this.clock);
  }

  schedule(delayMs: number, fn: () => void): CancelScheduled {
    const task: ManualTask = {
      at: this.clock + Math.max(0, delayMs),
      seq: this.seq++,
      fn,
      cancelled: false,
    };
    this.tasks.push(task);
    return () => {
      task.cancelled = true;
    };
  }

  /** Advances virtual time, running everything that becomes due, in order. */
  async advanceBy(ms: number): Promise<void> {
    const target = this.clock + Math.max(0, ms);
    for (;;) {
      const due = this.tasks
        .filter((task) => !task.cancelled && task.at <= target)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (!due) break;
      this.tasks = this.tasks.filter((task) => task !== due);
      this.clock = Math.max(this.clock, due.at);
      due.fn();
      await tick();
    }
    this.clock = target;
  }

  /** Runs every pending task (and anything they schedule) to exhaustion. */
  async runAll(maxRounds = 1_000): Promise<void> {
    for (let round = 0; round < maxRounds; round++) {
      const pending = this.tasks.filter((task) => !task.cancelled);
      if (pending.length === 0) return;
      const furthest = Math.max(...pending.map((task) => task.at));
      await this.advanceBy(Math.max(0, furthest - this.clock));
    }
    throw new Error(`ManualScheduler.runAll exceeded ${maxRounds} rounds`);
  }
}

/** Yields to the macrotask queue so pending promise chains can settle. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

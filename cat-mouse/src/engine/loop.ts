import type { Clock, LoopCallbacks, LoopOptions } from './types';
import { clamp } from './math';

export const DEFAULT_STEP = 1 / 60;

/** Mutable clock the loop owns; consumers only see the readonly `Clock` face. */
class MutableClock implements Clock {
  elapsed = 0;
  step: number;
  tick = 0;
  alpha = 0;
  frameDelta = 0;
  scale = 1;

  constructor(step: number) {
    this.step = step;
  }
}

/**
 * Fixed-timestep loop with an accumulator and a spiral-of-death guard: when a
 * frame exceeds `maxStepsPerFrame` the leftover time is dropped rather than
 * simulated, so a slow tab resumes instead of freezing.
 */
export class FixedLoop {
  private readonly callbacks: LoopCallbacks;
  private readonly clock: MutableClock;
  private readonly maxFrameDelta: number;
  private readonly maxStepsPerFrame: number;
  private readonly now: () => number;
  private readonly schedule: (cb: (timeMs: number) => void) => number;
  private readonly cancel: (handle: number) => void;
  private accumulator = 0;
  private lastTime = 0;
  private handle = 0;
  private running = false;
  private droppedFrames = 0;
  private fpsWindow: number[] = [];

  constructor(callbacks: LoopCallbacks, options: LoopOptions = {}) {
    this.callbacks = callbacks;
    this.clock = new MutableClock(options.step ?? DEFAULT_STEP);
    this.maxFrameDelta = options.maxFrameDelta ?? 0.25;
    this.maxStepsPerFrame = options.maxStepsPerFrame ?? 5;
    this.now = options.now ?? defaultNow;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get dropped(): number {
    return this.droppedFrames;
  }

  get fps(): number {
    if (this.fpsWindow.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < this.fpsWindow.length; i += 1) total += this.fpsWindow[i] as number;
    const average = total / this.fpsWindow.length;
    return average > 0 ? 1 / average : 0;
  }

  clockView(): Clock {
    return this.clock;
  }

  setTimeScale(scale: number): void {
    this.clock.scale = clamp(scale, 0, 8);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = this.now();
    this.handle = this.schedule(this.frame);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.cancel(this.handle);
    this.handle = 0;
  }

  /** Drives the loop manually; headless tests and replays use this. */
  advance(seconds: number): number {
    this.clock.frameDelta = seconds;
    this.accumulator += seconds * this.clock.scale;
    let steps = 0;
    while (this.accumulator >= this.clock.step && steps < this.maxStepsPerFrame) {
      this.callbacks.fixedUpdate(this.clock.step, this.clock);
      this.accumulator -= this.clock.step;
      this.clock.elapsed += this.clock.step;
      this.clock.tick += 1;
      steps += 1;
    }
    if (this.accumulator >= this.clock.step) {
      this.droppedFrames += 1;
      this.accumulator = 0;
    }
    this.clock.alpha = this.clock.step > 0 ? clamp(this.accumulator / this.clock.step, 0, 1) : 0;
    this.callbacks.render(this.clock.alpha, this.clock);
    return steps;
  }

  private readonly frame = (timeMs: number): void => {
    if (!this.running) return;
    const time = timeMs > 0 ? timeMs / 1000 : this.now();
    let delta = time - this.lastTime;
    this.lastTime = time;
    if (!Number.isFinite(delta) || delta < 0) delta = 0;
    if (delta > this.maxFrameDelta) delta = this.maxFrameDelta;
    this.trackFps(delta);
    this.advance(delta);
    this.handle = this.schedule(this.frame);
  };

  private trackFps(delta: number): void {
    this.fpsWindow.push(delta);
    if (this.fpsWindow.length > 60) this.fpsWindow.shift();
  }
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now() / 1000;
  }
  return Date.now() / 1000;
}

function defaultSchedule(cb: (timeMs: number) => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(() => cb(defaultNow() * 1000), 16) as unknown as number;
}

function defaultCancel(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle as unknown as ReturnType<typeof setTimeout>);
}

/** Deterministic clock for headless simulation and unit tests. */
export class StepClock implements Clock {
  elapsed = 0;
  readonly step: number;
  tick = 0;
  alpha = 0;
  frameDelta = 0;
  scale = 1;

  constructor(step = DEFAULT_STEP) {
    this.step = step;
    this.frameDelta = step;
  }

  advance(): void {
    this.elapsed += this.step;
    this.tick += 1;
    this.frameDelta = this.step;
  }

  reset(): void {
    this.elapsed = 0;
    this.tick = 0;
    this.alpha = 0;
  }
}

/** Rolling timing sampler backing the debug frame graph. */
export class FrameTimer {
  private readonly samples: number[] = [];
  private readonly capacity: number;

  constructor(capacity = 120) {
    this.capacity = capacity;
  }

  push(seconds: number): void {
    this.samples.push(seconds);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get average(): number {
    if (this.samples.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < this.samples.length; i += 1) total += this.samples[i] as number;
    return total / this.samples.length;
  }

  get worst(): number {
    let worst = 0;
    for (let i = 0; i < this.samples.length; i += 1) {
      const value = this.samples[i] as number;
      if (value > worst) worst = value;
    }
    return worst;
  }

  history(): readonly number[] {
    return this.samples;
  }

  clear(): void {
    this.samples.length = 0;
  }
}

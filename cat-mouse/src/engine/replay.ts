import { FrozenInput, encodeInput } from './input';
import type { InputSnapshot, ReplayFrame, ReplayLog } from './types';

export function encodeFrame(tick: number, input: InputSnapshot | number): ReplayFrame {
  return { tick, bits: typeof input === 'number' ? input : encodeInput(input) };
}

/**
 * Compact input log. Consecutive identical bitmasks are omitted; playback
 * holds the last recorded bits until the next frame.
 */
export class ReplayRecorder {
  readonly seed: number;
  readonly stageId: string;
  private readonly frames: ReplayFrame[] = [];
  private lastBits = -1;

  constructor(seed: number, stageId: string) {
    this.seed = seed;
    this.stageId = stageId;
  }

  record(tick: number, input: InputSnapshot | number): void {
    const bits = typeof input === 'number' ? input : encodeInput(input);
    if (bits === this.lastBits && this.frames.length > 0) return;
    this.frames.push({ tick, bits });
    this.lastBits = bits;
  }

  finish(): ReplayLog {
    return { seed: this.seed, stageId: this.stageId, frames: this.frames.slice() };
  }

  get length(): number {
    return this.frames.length;
  }
}

export class ReplayPlayer {
  readonly log: ReplayLog;
  private cursor = 0;

  constructor(log: ReplayLog) {
    this.log = log;
  }

  get seed(): number {
    return this.log.seed;
  }

  get stageId(): string {
    return this.log.stageId;
  }

  reset(): void {
    this.cursor = 0;
  }

  bitsAt(tick: number): number {
    const frames = this.log.frames;
    if (frames.length === 0) return 0;
    while (this.cursor + 1 < frames.length && frames[this.cursor + 1]!.tick <= tick) {
      this.cursor += 1;
    }
    while (this.cursor > 0 && frames[this.cursor]!.tick > tick) {
      this.cursor -= 1;
    }
    const frame = frames[this.cursor]!;
    return frame.tick <= tick ? frame.bits : 0;
  }

  inputAt(tick: number, previousBits = 0): InputSnapshot {
    return new FrozenInput(this.bitsAt(tick), previousBits);
  }

  lastTick(): number {
    const frames = this.log.frames;
    if (frames.length === 0) return 0;
    return frames[frames.length - 1]!.tick;
  }
}

export function serializeReplay(log: ReplayLog): string {
  return JSON.stringify(log);
}

export function parseReplay(raw: string): ReplayLog | null {
  try {
    const data = JSON.parse(raw) as Partial<ReplayLog>;
    if (!data || typeof data.seed !== 'number' || typeof data.stageId !== 'string') return null;
    if (!Array.isArray(data.frames)) return null;
    const frames: ReplayFrame[] = [];
    for (let i = 0; i < data.frames.length; i += 1) {
      const f = data.frames[i] as Partial<ReplayFrame>;
      if (typeof f.tick !== 'number' || typeof f.bits !== 'number') return null;
      frames.push({ tick: f.tick, bits: f.bits });
    }
    return { seed: data.seed, stageId: data.stageId, frames };
  } catch {
    return null;
  }
}

export function replayEquals(a: ReplayLog, b: ReplayLog): boolean {
  if (a.seed !== b.seed || a.stageId !== b.stageId || a.frames.length !== b.frames.length) return false;
  for (let i = 0; i < a.frames.length; i += 1) {
    if (a.frames[i]!.tick !== b.frames[i]!.tick || a.frames[i]!.bits !== b.frames[i]!.bits) return false;
  }
  return true;
}

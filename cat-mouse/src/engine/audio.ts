import type { AudioBusName, AudioCue, AudioLike } from './types';

const BUSES: readonly AudioBusName[] = ['master', 'sfx', 'music', 'ui', 'ambience'];

export interface DuckState {
  amount: number;
  remaining: number;
  duration: number;
}

export interface AudioEngineOptions {
  maxDistance?: number;
  minDistance?: number;
  rolloff?: number;
  context?: AudioContext;
}

/**
 * Oscillator synth with per-bus gain, mute, ducking and distance falloff.
 * Safe to construct without a window — play becomes a no-op until a context
 * exists (or `unlock()` creates one after a user gesture).
 */
export class AudioEngine implements AudioLike {
  muted = false;
  readonly maxDistance: number;
  readonly minDistance: number;
  readonly rolloff: number;
  private context: AudioContext | null;
  private readonly gains = new Map<AudioBusName, number>();
  private readonly ducks = new Map<AudioBusName, DuckState>();
  private listenerX = 0;
  private listenerY = 0;
  private lastPlay = 0;
  private voices = 0;

  constructor(options: AudioEngineOptions = {}) {
    this.maxDistance = options.maxDistance ?? 320;
    this.minDistance = options.minDistance ?? 24;
    this.rolloff = options.rolloff ?? 1;
    this.context = options.context ?? null;
    for (const bus of BUSES) this.gains.set(bus, bus === 'master' ? 0.85 : 1);
  }

  get voiceCount(): number {
    return this.voices;
  }

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  listener(): { x: number; y: number } {
    return { x: this.listenerX, y: this.listenerY };
  }

  setBusGain(bus: AudioBusName, gain: number): void {
    this.gains.set(bus, clamp01(gain));
  }

  busGain(bus: AudioBusName): number {
    return this.gains.get(bus) ?? 1;
  }

  duck(bus: AudioBusName, amount: number, seconds: number): void {
    this.ducks.set(bus, { amount: clamp01(amount), remaining: seconds, duration: Math.max(0.001, seconds) });
  }

  update(dt: number): void {
    for (const [bus, duck] of this.ducks) {
      duck.remaining -= dt;
      if (duck.remaining <= 0) this.ducks.delete(bus);
    }
  }

  spatialGain(atX: number, atY: number): number {
    const dist = Math.hypot(atX - this.listenerX, atY - this.listenerY);
    if (dist <= this.minDistance) return 1;
    if (dist >= this.maxDistance) return 0;
    const t = (dist - this.minDistance) / (this.maxDistance - this.minDistance);
    return Math.pow(1 - t, this.rolloff);
  }

  effectiveGain(bus: AudioBusName, atX?: number, atY?: number): number {
    if (this.muted) return 0;
    const master = this.busGain('master') * this.duckFactor('master');
    const local = this.busGain(bus) * this.duckFactor(bus);
    const spatial = atX === undefined || atY === undefined ? 1 : this.spatialGain(atX, atY);
    return master * local * spatial;
  }

  play(cue: AudioCue, atX?: number, atY?: number): void {
    const gain = this.effectiveGain(cue.bus, atX, atY) * cue.gain;
    this.lastPlay = gain;
    if (gain <= 1e-4 || cue.duration <= 0) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const node = ctx.createGain();
    osc.type = cue.type;
    osc.frequency.setValueAtTime(cue.frequency, now);
    if (cue.sweep !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, cue.frequency + cue.sweep), now + cue.duration);
    }
    node.gain.setValueAtTime(0.0001, now);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + 0.012);
    node.gain.exponentialRampToValueAtTime(0.0001, now + cue.duration);
    osc.connect(node);
    node.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + cue.duration + 0.02);
    this.voices += 1;
    osc.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      osc.disconnect();
      node.disconnect();
    };
  }

  /** Resume a suspended context after a click / key — required by browsers. */
  async unlock(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') await ctx.resume();
  }

  lastGain(): number {
    return this.lastPlay;
  }

  private duckFactor(bus: AudioBusName): number {
    const duck = this.ducks.get(bus);
    if (!duck) return 1;
    const t = Math.max(0, duck.remaining / duck.duration);
    return 1 - duck.amount * t;
  }

  private ensureContext(): AudioContext | null {
    if (this.context) return this.context;
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : undefined;
    if (!Ctor) return null;
    this.context = new Ctor();
    return this.context;
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export const CUES = {
  dash: cue('dash', 'sfx', 520, 0.09, 'square', 0.18, -220),
  sneak: cue('sneak', 'sfx', 180, 0.05, 'sine', 0.06),
  cheese: cue('cheese', 'sfx', 740, 0.12, 'triangle', 0.2, 180),
  bank: cue('bank', 'sfx', 420, 0.18, 'square', 0.16, 260),
  caught: cue('caught', 'sfx', 90, 0.28, 'sawtooth', 0.22, -40),
  catch: cue('catch', 'sfx', 90, 0.28, 'sawtooth', 0.22, -40),
  ui: cue('ui', 'ui', 660, 0.06, 'square', 0.1),
  pause: cue('pause', 'ui', 300, 0.08, 'triangle', 0.08),
  ambient: cue('ambient', 'ambience', 110, 0.4, 'sine', 0.04),
} as const;

function cue(
  id: string,
  bus: AudioBusName,
  frequency: number,
  duration: number,
  type: OscillatorType,
  gain: number,
  sweep?: number,
): AudioCue {
  return { id, bus, frequency, duration, type, gain, sweep };
}

export function makeAudio(options?: AudioEngineOptions): AudioEngine {
  return new AudioEngine(options);
}

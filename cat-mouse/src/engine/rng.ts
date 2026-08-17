import type { Rng } from './types';

/**
 * Mulberry32: small, fast, deterministic 32-bit PRNG. Chosen so replays and
 * generated stages reproduce exactly across platforms.
 */
export class Mulberry32 implements Rng {
  readonly seed: number;
  private s: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.s = this.seed;
  }

  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  int(minInclusive: number, maxExclusive: number): number {
    if (maxExclusive <= minInclusive) return minInclusive;
    return minInclusive + Math.floor(this.next() * (maxExclusive - minInclusive));
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  bool(chance = 0.5): boolean {
    return this.next() < chance;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick called with an empty list');
    return items[this.int(0, items.length)] as T;
  }

  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i + 1);
      const tmp = items[i] as T;
      items[i] = items[j] as T;
      items[j] = tmp;
    }
    return items;
  }

  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (let i = 0; i < items.length; i += 1) total += Math.max(0, weightOf(items[i] as T));
    if (total <= 0) return this.pick(items);
    let roll = this.next() * total;
    for (let i = 0; i < items.length; i += 1) {
      roll -= Math.max(0, weightOf(items[i] as T));
      if (roll <= 0) return items[i] as T;
    }
    return items[items.length - 1] as T;
  }

  fork(salt: number): Rng {
    return new Mulberry32((this.s ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0);
  }

  state(): number {
    return this.s >>> 0;
  }

  restore(state: number): void {
    this.s = state >>> 0;
  }
}

export function makeRng(seed: number): Rng {
  return new Mulberry32(seed);
}

/** FNV-1a string hash, used to derive stable seeds from stage ids. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function seedFrom(...parts: (string | number)[]): number {
  let seed = 0x2545f491;
  for (const part of parts) {
    const value = typeof part === 'number' ? Math.trunc(part) >>> 0 : hashString(part);
    seed = (Math.imul(seed ^ value, 0x27220a95) + 0x165667b1) >>> 0;
  }
  return seed >>> 0;
}

/** Value noise in 1D; smooth pseudo-random curve for flicker and drift. */
export function valueNoise1(x: number, seed = 0): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = hashUnit(i, seed);
  const b = hashUnit(i + 1, seed);
  const t = f * f * (3 - 2 * f);
  return a + (b - a) * t;
}

export function valueNoise2(x: number, y: number, seed = 0): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = hashUnit2(xi, yi, seed);
  const tr = hashUnit2(xi + 1, yi, seed);
  const bl = hashUnit2(xi, yi + 1, seed);
  const br = hashUnit2(xi + 1, yi + 1, seed);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const top = tl + (tr - tl) * u;
  const bottom = bl + (br - bl) * u;
  return top + (bottom - top) * v;
}

export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  let total = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise2(x * frequency, y * frequency, seed + i * 977) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? total / norm : 0;
}

function hashUnit(i: number, seed: number): number {
  let h = Math.imul(i ^ seed, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

function hashUnit2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca6b) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

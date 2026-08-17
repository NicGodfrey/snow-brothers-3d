import type { ScentSampleLike, TileMapLike, Vec2 } from './types';

const DEFAULT_RETENTION = 0.86;
const DEFAULT_DIFFUSE = 0.35;

export interface ScentFieldOptions {
  width: number;
  height: number;
  /** Multiplier applied after tile retention each second. */
  decay?: number;
  /** Fraction of surplus shared with 4-neighbours per second. */
  diffuse?: number;
}

/**
 * Discrete scent field. Cats climb the gradient; tiles with low
 * `scentRetention` (water, grates) forget trails quickly.
 */
export class ScentField implements ScentSampleLike {
  readonly width: number;
  readonly height: number;
  private current: Float32Array;
  private next: Float32Array;
  private readonly decay: number;
  private readonly diffuse: number;

  constructor(options: ScentFieldOptions) {
    this.width = options.width;
    this.height = options.height;
    this.decay = options.decay ?? 1;
    this.diffuse = options.diffuse ?? DEFAULT_DIFFUSE;
    const n = this.width * this.height;
    this.current = new Float32Array(n);
    this.next = new Float32Array(n);
  }

  static fromMap(map: TileMapLike, extra?: Omit<ScentFieldOptions, 'width' | 'height'>): ScentField {
    return new ScentField({ width: map.width, height: map.height, ...extra });
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  strength(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return 0;
    return this.current[this.index(ix, iy)] as number;
  }

  /** Bilinear sample for steering that is not snapped to tile centres. */
  sample(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const s00 = this.strength(x0, y0);
    const s10 = this.strength(x0 + 1, y0);
    const s01 = this.strength(x0, y0 + 1);
    const s11 = this.strength(x0 + 1, y0 + 1);
    const top = s00 + (s10 - s00) * tx;
    const bottom = s01 + (s11 - s01) * tx;
    return top + (bottom - top) * ty;
  }

  /** Finite-difference gradient pointing toward *increasing* scent. */
  gradient(x: number, y: number): Vec2 {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const gx = this.strength(ix + 1, iy) - this.strength(ix - 1, iy);
    const gy = this.strength(ix, iy + 1) - this.strength(ix, iy - 1);
    return { x: gx * 0.5, y: gy * 0.5 };
  }

  set(x: number, y: number, value: number): void {
    if (!this.inBounds(x, y)) return;
    this.current[this.index(x, y)] = Math.max(0, value);
  }

  add(x: number, y: number, amount: number): void {
    if (!this.inBounds(x, y)) return;
    const i = this.index(x, y);
    this.current[i] = Math.max(0, (this.current[i] as number) + amount);
  }

  deposit(x: number, y: number, amount: number, radius = 0): void {
    if (radius <= 0) {
      this.add(x, y, amount);
      return;
    }
    const r = Math.ceil(radius);
    const rSq = radius * radius;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const distSq = dx * dx + dy * dy;
        if (distSq > rSq) continue;
        const falloff = 1 - Math.sqrt(distSq) / (radius + 1e-6);
        this.add(x + dx, y + dy, amount * falloff);
      }
    }
  }

  depositWorld(worldX: number, worldY: number, tileSize: number, amount: number, radius = 0): void {
    this.deposit(Math.floor(worldX / tileSize), Math.floor(worldY / tileSize), amount, radius);
  }

  /** Multiplies every cell by `retention^dt`, optionally using per-tile rates. */
  decayStep(dt: number, map?: TileMapLike): void {
    if (dt <= 0) return;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const i = this.index(x, y);
        const value = this.current[i] as number;
        if (value <= 0) {
          this.current[i] = 0;
          continue;
        }
        const retention = map ? map.props(x, y).scentRetention : DEFAULT_RETENTION;
        const keep = Math.pow(Math.max(0, retention) * this.decay, dt);
        this.current[i] = value * keep;
        if ((this.current[i] as number) < 1e-5) this.current[i] = 0;
      }
    }
  }

  /**
   * 4-neighbour leak. Solid / infinite-cost tiles neither emit nor receive.
   * `rate` is the fraction of a cell's value offered to neighbours per second.
   */
  diffuseStep(dt: number, map?: TileMapLike, rate = this.diffuse): void {
    if (dt <= 0 || rate <= 0) return;
    const share = 1 - Math.exp(-rate * dt);
    this.next.set(this.current);
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (blocksScent(map, x, y)) continue;
        const value = this.current[this.index(x, y)] as number;
        if (value <= 0) continue;
        const offer = value * share * 0.25;
        let given = 0;
        given += this.tryLeak(x + 1, y, offer, map);
        given += this.tryLeak(x - 1, y, offer, map);
        given += this.tryLeak(x, y + 1, offer, map);
        given += this.tryLeak(x, y - 1, offer, map);
        this.next[this.index(x, y)] = (this.next[this.index(x, y)] as number) - given;
      }
    }
    const swap = this.current;
    this.current = this.next;
    this.next = swap;
  }

  private tryLeak(x: number, y: number, offer: number, map?: TileMapLike): number {
    if (!this.inBounds(x, y) || blocksScent(map, x, y)) return 0;
    this.next[this.index(x, y)] = (this.next[this.index(x, y)] as number) + offer;
    return offer;
  }

  /** Decay then diffuse. Call once per fixed tick. */
  step(dt: number, map?: TileMapLike): void {
    this.decayStep(dt, map);
    this.diffuseStep(dt, map);
  }

  clear(): void {
    this.current.fill(0);
    this.next.fill(0);
  }

  peak(): { x: number; y: number; value: number } {
    let best = 0;
    let bx = 0;
    let by = 0;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const v = this.current[this.index(x, y)] as number;
        if (v > best) {
          best = v;
          bx = x;
          by = y;
        }
      }
    }
    return { x: bx, y: by, value: best };
  }

  total(): number {
    let sum = 0;
    for (let i = 0; i < this.current.length; i += 1) sum += this.current[i] as number;
    return sum;
  }

  clone(): ScentField {
    const copy = new ScentField({
      width: this.width,
      height: this.height,
      decay: this.decay,
      diffuse: this.diffuse,
    });
    copy.current.set(this.current);
    return copy;
  }

  raw(): Float32Array {
    return this.current;
  }
}

function blocksScent(map: TileMapLike | undefined, x: number, y: number): boolean {
  if (!map) return false;
  if (!map.inBounds(x, y)) return true;
  const p = map.props(x, y);
  return p.solid || !Number.isFinite(p.cost);
}

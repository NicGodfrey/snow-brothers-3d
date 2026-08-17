import type { Vec2 } from './types';

export interface InfluenceSource {
  x: number;
  y: number;
  strength: number;
  radius: number;
}

/**
 * Coarse attraction / threat field. Positive cells pull (cheese, hole);
 * negative cells push (cat last-known, traps).
 */
export class InfluenceMap {
  readonly width: number;
  readonly height: number;
  private readonly cells: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Float32Array(width * height);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  sample(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (!this.inBounds(ix, iy)) return 0;
    return this.cells[this.index(ix, iy)] as number;
  }

  add(x: number, y: number, amount: number): void {
    if (!this.inBounds(x, y)) return;
    this.cells[this.index(x, y)] = (this.cells[this.index(x, y)] as number) + amount;
  }

  addSource(source: InfluenceSource): void {
    const r = Math.ceil(source.radius);
    const rSq = source.radius * source.radius;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy > rSq) continue;
        const falloff = 1 - Math.sqrt(dx * dx + dy * dy) / (source.radius + 1e-6);
        this.add(source.x + dx, source.y + dy, source.strength * falloff);
      }
    }
  }

  decay(dt: number, rate = 1.2): void {
    const keep = Math.exp(-rate * dt);
    for (let i = 0; i < this.cells.length; i += 1) this.cells[i] = (this.cells[i] as number) * keep;
  }

  gradient(x: number, y: number): Vec2 {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    return {
      x: (this.sample(ix + 1, iy) - this.sample(ix - 1, iy)) * 0.5,
      y: (this.sample(ix, iy + 1) - this.sample(ix, iy - 1)) * 0.5,
    };
  }

  peak(): { x: number; y: number; value: number } {
    let best = -Infinity;
    let bx = 0;
    let by = 0;
    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        const v = this.cells[this.index(x, y)] as number;
        if (v > best) {
          best = v;
          bx = x;
          by = y;
        }
      }
    }
    return { x: bx, y: by, value: best };
  }

  clear(): void {
    this.cells.fill(0);
  }
}

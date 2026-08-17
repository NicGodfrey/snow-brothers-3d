/**
 * Uniform-grid spatial hash for broad-phase queries (cat vs cheese, decoys,
 * hazards). Rebuilt each tick; cell size should be roughly the largest body.
 */

import type { Rect, SpatialHashLike } from './types';

interface Entry<T> {
  item: T;
  bounds: Rect;
}

export class SpatialHash<T> implements SpatialHashLike<T> {
  private readonly cells = new Map<number, Entry<T>[]>();
  private readonly cellSize: number;
  private count = 0;
  private queryStamp = 0;
  private readonly seen = new Map<T, number>();

  constructor(cellSize = 64) {
    this.cellSize = Math.max(1, cellSize);
  }

  get size(): number {
    return this.count;
  }

  private key(cx: number, cy: number): number {
    // Cantor-style pairing keeps negatives distinct without string keys.
    const a = cx >= 0 ? cx * 2 : -cx * 2 - 1;
    const b = cy >= 0 ? cy * 2 : -cy * 2 - 1;
    return ((a + b) * (a + b + 1)) / 2 + b;
  }

  insert(item: T, bounds: Rect): void {
    const minX = Math.floor(bounds.x / this.cellSize);
    const minY = Math.floor(bounds.y / this.cellSize);
    const maxX = Math.floor((bounds.x + bounds.w) / this.cellSize);
    const maxY = Math.floor((bounds.y + bounds.h) / this.cellSize);
    const entry: Entry<T> = { item, bounds };
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const k = this.key(cx, cy);
        const bucket = this.cells.get(k);
        if (bucket) bucket.push(entry);
        else this.cells.set(k, [entry]);
      }
    }
    this.count += 1;
  }

  insertCircle(item: T, x: number, y: number, radius: number): void {
    this.insert(item, { x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 });
  }

  clear(): void {
    this.cells.clear();
    this.count = 0;
    this.seen.clear();
  }

  query(bounds: Rect): readonly T[] {
    const minX = Math.floor(bounds.x / this.cellSize);
    const minY = Math.floor(bounds.y / this.cellSize);
    const maxX = Math.floor((bounds.x + bounds.w) / this.cellSize);
    const maxY = Math.floor((bounds.y + bounds.h) / this.cellSize);
    this.queryStamp += 1;
    const stamp = this.queryStamp;
    const out: T[] = [];
    for (let cy = minY; cy <= maxY; cy += 1) {
      for (let cx = minX; cx <= maxX; cx += 1) {
        const bucket = this.cells.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const entry of bucket) {
          if (this.seen.get(entry.item) === stamp) continue;
          if (!overlaps(entry.bounds, bounds)) continue;
          this.seen.set(entry.item, stamp);
          out.push(entry.item);
        }
      }
    }
    return out;
  }

  queryCircle(x: number, y: number, radius: number): readonly T[] {
    return this.query({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 });
  }

  get bucketCount(): number {
    return this.cells.size;
  }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** Rolling frame-time graph for the debug HUD. */
export class FrameGraph {
  private readonly samples: number[] = [];

  constructor(private readonly capacity = 120) {}

  push(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
  }

  get average(): number {
    if (this.samples.length === 0) return 0;
    let sum = 0;
    for (const s of this.samples) sum += s;
    return sum / this.samples.length;
  }

  get worst(): number {
    let max = 0;
    for (const s of this.samples) if (s > max) max = s;
    return max;
  }

  get fps(): number {
    const avg = this.average;
    return avg > 0 ? 1000 / avg : 0;
  }

  values(): readonly number[] {
    return this.samples;
  }

  clear(): void {
    this.samples.length = 0;
  }
}

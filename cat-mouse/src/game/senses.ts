import { bresenham, distance, inCone, vec2 } from '../engine/math';
import type { ScentSampleLike, TileMapLike, Vec2 } from '../engine/types';
import type { CatRuntime, DecoyRuntime, LightRuntime, MouseRuntime } from './types';
import { canHear, canSee, isInvisible, scentMultiplier } from './status';
import { mouseHiddenAt } from './tiles';

export class ScentField implements ScentSampleLike {
  readonly width: number;
  readonly height: number;
  private readonly cells: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.cells = new Float32Array(width * height);
  }

  private index(tx: number, ty: number): number {
    return ty * this.width + tx;
  }

  inBounds(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  deposit(x: number, y: number, amount: number): void {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.inBounds(tx, ty) || amount <= 0) return;
    const i = this.index(tx, ty);
    this.cells[i] = Math.min(4, (this.cells[i] ?? 0) + amount);
    for (const [dx, dy, w] of [
      [1, 0, 0.35],
      [-1, 0, 0.35],
      [0, 1, 0.35],
      [0, -1, 0.35],
    ] as const) {
      if (!this.inBounds(tx + dx, ty + dy)) continue;
      const j = this.index(tx + dx, ty + dy);
      this.cells[j] = Math.min(4, (this.cells[j] ?? 0) + amount * w);
    }
  }

  strength(x: number, y: number): number {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (!this.inBounds(tx, ty)) return 0;
    return this.cells[this.index(tx, ty)] ?? 0;
  }

  gradient(x: number, y: number): Vec2 {
    const s = this.strength.bind(this);
    const gx = s(x + 1, y) - s(x - 1, y);
    const gy = s(x, y + 1) - s(x, y - 1);
    return vec2(gx, gy);
  }

  peakNear(x: number, y: number, radius = 3): { x: number; y: number; strength: number } {
    const ox = Math.floor(x);
    const oy = Math.floor(y);
    let best = { x: ox + 0.5, y: oy + 0.5, strength: 0 };
    for (let ty = oy - radius; ty <= oy + radius; ty += 1) {
      for (let tx = ox - radius; tx <= ox + radius; tx += 1) {
        if (!this.inBounds(tx, ty)) continue;
        const value = this.cells[this.index(tx, ty)] ?? 0;
        if (value > best.strength) best = { x: tx + 0.5, y: ty + 0.5, strength: value };
      }
    }
    return best;
  }

  tick(dt: number, tiles: TileMapLike): void {
    const next = new Float32Array(this.cells.length);
    for (let ty = 0; ty < this.height; ty += 1) {
      for (let tx = 0; tx < this.width; tx += 1) {
        const i = this.index(tx, ty);
        const props = tiles.props(tx, ty);
        const keep = Math.pow(Math.max(0, Math.min(0.98, props.scentRetention)), dt);
        let value = (this.cells[i] ?? 0) * keep;
        if (props.solid) value *= 0.35;
        next[i] = value;
      }
    }
    for (let ty = 1; ty < this.height - 1; ty += 1) {
      for (let tx = 1; tx < this.width - 1; tx += 1) {
        const i = this.index(tx, ty);
        const spread =
          ((next[i - 1] ?? 0) + (next[i + 1] ?? 0) + (next[i - this.width] ?? 0) + (next[i + this.width] ?? 0)) * 0.08;
        next[i] = (next[i] ?? 0) * 0.72 + spread;
      }
    }
    this.cells.set(next);
  }

  clear(): void {
    this.cells.fill(0);
  }
}

export function lineOfSight(
  tiles: TileMapLike,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const points = bresenham(Math.floor(ax), Math.floor(ay), Math.floor(bx), Math.floor(by));
  for (let i = 1; i < points.length - 1; i += 1) {
    const p = points[i]!;
    if (tiles.props(p.x, p.y).opaque) return false;
  }
  return true;
}

export function lightAt(lights: readonly LightRuntime[], x: number, y: number, ambient = 0.22): number {
  let best = ambient;
  for (let i = 0; i < lights.length; i += 1) {
    const light = lights[i]!;
    if (!light.on || light.radius <= 0) continue;
    const d = distance(light.x, light.y, x, y);
    if (d >= light.radius) continue;
    const intensity = light.intensity * (1 - d / light.radius);
    if (intensity > best) best = intensity;
  }
  return best;
}

export interface SenseReport {
  visible: boolean;
  peripheral: boolean;
  hearing: number;
  scent: number;
  scentDir: Vec2;
  los: boolean;
}

export function catCanSee(
  cat: CatRuntime,
  targetX: number,
  targetY: number,
  tiles: TileMapLike,
  lights: readonly LightRuntime[],
  ambient = 0.22,
): { visible: boolean; peripheral: boolean; los: boolean } {
  if (!canSee(cat.statuses)) return { visible: false, peripheral: false, los: false };
  const t = cat.transform;
  const los = lineOfSight(tiles, t.x, t.y, targetX, targetY);
  if (!los) return { visible: false, peripheral: false, los: false };
  const lit = lightAt(lights, targetX, targetY, ambient);
  const rangeScale = 0.52 + 0.48 * Math.min(1, lit / 0.7);
  const range = cat.stats.sightRange * rangeScale;
  const visible = inCone(t.x, t.y, t.facing, cat.stats.sightHalfAngle, range, targetX, targetY);
  const peripheral = inCone(
    t.x,
    t.y,
    t.facing,
    cat.stats.sightHalfAngle * 1.85,
    cat.stats.peripheralRange * (0.7 + 0.3 * rangeScale),
    targetX,
    targetY,
  );
  return { visible, peripheral: peripheral && !visible, los };
}

export function hearingAt(
  cat: CatRuntime,
  x: number,
  y: number,
  loudness: number,
  hearingBias = 1,
): number {
  if (loudness <= 0 || !canHear(cat.statuses)) return 0;
  const dist = distance(cat.transform.x, cat.transform.y, x, y);
  const range = Math.max(0.5, cat.stats.hearingRange * hearingBias);
  const falloff = 1 / (1 + (dist * dist) / (range * range));
  return loudness * falloff;
}

export function sampleScent(
  field: ScentSampleLike,
  cat: CatRuntime,
  scentBias = 1,
): { strength: number; gradient: Vec2 } {
  const strength = field.strength(cat.transform.x, cat.transform.y) * cat.stats.scentSensitivity * scentBias;
  return { strength, gradient: field.gradient(cat.transform.x, cat.transform.y) };
}

export function senseMouse(
  cat: CatRuntime,
  mouse: MouseRuntime,
  tiles: TileMapLike,
  scent: ScentSampleLike,
  lights: readonly LightRuntime[],
  noise: { x: number; y: number; loudness: number } | null,
  hearingBias = 1,
  scentBias = 1,
  ambient = 0.22,
): SenseReport {
  const hidden = mouseHiddenAt(tiles, mouse.transform.x, mouse.transform.y);
  const invisible = isInvisible(mouse.statuses);
  const vision = invisible || hidden
    ? { visible: false, peripheral: false, los: lineOfSight(tiles, cat.transform.x, cat.transform.y, mouse.transform.x, mouse.transform.y) }
    : catCanSee(cat, mouse.transform.x, mouse.transform.y, tiles, lights, ambient);
  const loudness = noise ? noise.loudness : mouse.lastNoise;
  const nx = noise ? noise.x : mouse.transform.x;
  const ny = noise ? noise.y : mouse.transform.y;
  const hearing = hearingAt(cat, nx, ny, loudness, hearingBias);
  const scentSample = sampleScent(scent, cat, scentBias * scentMultiplier(mouse.statuses));
  return {
    visible: vision.visible,
    peripheral: vision.peripheral,
    hearing,
    scent: scentSample.strength,
    scentDir: scentSample.gradient,
    los: vision.los,
  };
}

export function senseDecoy(
  cat: CatRuntime,
  decoys: readonly DecoyRuntime[],
  hearingBias = 1,
): { decoy: DecoyRuntime | null; hearing: number } {
  let best: DecoyRuntime | null = null;
  let bestH = 0;
  for (let i = 0; i < decoys.length; i += 1) {
    const decoy = decoys[i]!;
    if (decoy.life <= 0) continue;
    const h = hearingAt(cat, decoy.x, decoy.y, decoy.noise, hearingBias);
    if (h > bestH) {
      bestH = h;
      best = decoy;
    }
  }
  return { decoy: bestH > 0.08 ? best : null, hearing: bestH };
}

export function tickDecoys(decoys: DecoyRuntime[], dt: number): void {
  for (let i = decoys.length - 1; i >= 0; i -= 1) {
    const decoy = decoys[i]!;
    decoy.life -= dt;
    decoy.noise *= Math.max(0, 1 - dt * 0.18);
    if (decoy.life <= 0) decoys.splice(i, 1);
  }
}

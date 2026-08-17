import type { Bounds, Circle, Direction4, Direction8, Rect, Vec2 } from './types';

export const TAU = Math.PI * 2;
export const EPSILON = 1e-6;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(a: number, b: number, value: number): number {
  if (Math.abs(b - a) < EPSILON) return 0;
  return (value - a) / (b - a);
}

export function remap(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  return lerp(outMin, outMax, clamp01(inverseLerp(inMin, inMax, value)));
}

export function approach(current: number, target: number, maxDelta: number): number {
  if (current < target) return Math.min(current + maxDelta, target);
  if (current > target) return Math.max(current - maxDelta, target);
  return target;
}

/** Frame-rate independent exponential smoothing. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(target, current, Math.exp(-lambda * dt));
}

export function sign(value: number): number {
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

export function wrap(value: number, min: number, max: number): number {
  const span = max - min;
  if (span <= 0) return min;
  let v = (value - min) % span;
  if (v < 0) v += span;
  return v + min;
}

export function wrapAngle(radians: number): number {
  return wrap(radians, -Math.PI, Math.PI);
}

export function angleDelta(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function rotateToward(current: number, target: number, maxDelta: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) return wrapAngle(target);
  return wrapAngle(current + sign(delta) * maxDelta);
}

export function smoothStep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function smootherStep(t: number): number {
  const x = clamp01(t);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export function easeInQuad(t: number): number {
  return t * t;
}

export function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

export function easeOutElastic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

export function vec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function vAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function vSub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function vScale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

export function vDot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

export function vCross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function vLengthSq(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function vLength(a: Vec2): number {
  return Math.hypot(a.x, a.y);
}

export function vNormalize(a: Vec2): Vec2 {
  const len = vLength(a);
  if (len < EPSILON) return { x: 0, y: 0 };
  return { x: a.x / len, y: a.y / len };
}

export function vLimit(a: Vec2, max: number): Vec2 {
  const lenSq = vLengthSq(a);
  if (lenSq <= max * max || lenSq < EPSILON) return { x: a.x, y: a.y };
  const len = Math.sqrt(lenSq);
  return { x: (a.x / len) * max, y: (a.y / len) * max };
}

export function vLerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function vRotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
}

export function vFromAngle(radians: number, length = 1): Vec2 {
  return { x: Math.cos(radians) * length, y: Math.sin(radians) * length };
}

export function vAngle(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}

export function distanceSq(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

export function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(bx - ax) + Math.abs(by - ay);
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(bx - ax), Math.abs(by - ay));
}

/** Octile distance: the admissible heuristic for 8-way grids. */
export function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

export function rect(x: number, y: number, w: number, h: number): Rect {
  return { x, y, w, h };
}

export function rectContains(r: Rect, x: number, y: number): boolean {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function rectOverlap(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

export function rectCenter(r: Rect): Vec2 {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function rectExpand(r: Rect, amount: number): Rect {
  return { x: r.x - amount, y: r.y - amount, w: r.w + amount * 2, h: r.h + amount * 2 };
}

export function boundsOf(r: Rect): Bounds {
  return { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h };
}

export function circleIntersects(a: Circle, b: Circle): boolean {
  const r = a.r + b.r;
  return distanceSq(a.x, a.y, b.x, b.y) <= r * r;
}

export function circleRectIntersects(c: Circle, r: Rect): boolean {
  const nearestX = clamp(c.x, r.x, r.x + r.w);
  const nearestY = clamp(c.y, r.y, r.y + r.h);
  return distanceSq(c.x, c.y, nearestX, nearestY) <= c.r * c.r;
}

export function pointInCircle(x: number, y: number, c: Circle): boolean {
  return distanceSq(x, y, c.x, c.y) <= c.r * c.r;
}

/** True when `point` lies inside the cone centred on `facing`. */
export function inCone(
  originX: number,
  originY: number,
  facing: number,
  halfAngle: number,
  range: number,
  pointX: number,
  pointY: number,
): boolean {
  const dx = pointX - originX;
  const dy = pointY - originY;
  const distSq = dx * dx + dy * dy;
  if (distSq > range * range) return false;
  if (distSq < EPSILON) return true;
  const angle = Math.atan2(dy, dx);
  return Math.abs(angleDelta(facing, angle)) <= halfAngle;
}

export function directionOf4(dx: number, dy: number): Direction4 {
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

const DIR8: readonly Direction8[] = [
  'east',
  'southEast',
  'south',
  'southWest',
  'west',
  'northWest',
  'north',
  'northEast',
];

export function directionOf8(dx: number, dy: number): Direction8 {
  const angle = wrap(Math.atan2(dy, dx), 0, TAU);
  const octant = Math.round(angle / (TAU / 8)) % 8;
  return DIR8[octant] as Direction8;
}

export function moveTowards(current: Vec2, target: Vec2, maxDistance: number): Vec2 {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxDistance || dist < EPSILON) return { x: target.x, y: target.y };
  return { x: current.x + (dx / dist) * maxDistance, y: current.y + (dy / dist) * maxDistance };
}

/** Integer Bresenham walk; used by line-of-sight and scent tracing. */
export function bresenham(x0: number, y0: number, x1: number, y1: number): Vec2[] {
  const points: Vec2[] = [];
  let x = Math.trunc(x0);
  let y = Math.trunc(y0);
  const tx = Math.trunc(x1);
  const ty = Math.trunc(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard += 1) {
    points.push({ x, y });
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return points;
}

export function sumOf(values: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < values.length; i += 1) total += values[i] as number;
  return total;
}

export function averageOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return sumOf(values) / values.length;
}

export function maxOf(values: readonly number[]): number {
  let best = -Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (v > best) best = v;
  }
  return best;
}

export function minOf(values: readonly number[]): number {
  let best = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (v < best) best = v;
  }
  return best;
}

export function roundTo(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

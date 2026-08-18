/**
 * Tile-aware collision resolution for circular bodies, plus trigger volumes.
 * Movement is resolved per axis so bodies slide along walls instead of sticking.
 */

import { clamp } from './math';
import { TileMap } from './tiles';
import type { Circle, Rect, TileKind, Vec2 } from './types';

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  /** Mouse-sized bodies may enter vents, pipes and holes. */
  allowMouseOnly: boolean;
}

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
  /** World distance actually travelled. */
  traveled: number;
}

export function circleRectPenetration(c: Circle, r: Rect): Vec2 | null {
  const nearestX = clamp(c.x, r.x, r.x + r.w);
  const nearestY = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - nearestX;
  const dy = c.y - nearestY;
  const distSq = dx * dx + dy * dy;
  if (distSq >= c.r * c.r) return null;
  const dist = Math.sqrt(distSq);
  if (dist < 1e-6) {
    // Centre inside the rect: push out along the shallowest face.
    const left = c.x - r.x;
    const right = r.x + r.w - c.x;
    const top = c.y - r.y;
    const bottom = r.y + r.h - c.y;
    const min = Math.min(left, right, top, bottom);
    if (min === left) return { x: -(left + c.r), y: 0 };
    if (min === right) return { x: right + c.r, y: 0 };
    if (min === top) return { x: 0, y: -(top + c.r) };
    return { x: 0, y: bottom + c.r };
  }
  const overlap = c.r - dist;
  return { x: (dx / dist) * overlap, y: (dy / dist) * overlap };
}

export interface TileCollisionOptions {
  /** Previous centre. Required to decide one-way platform landings. */
  fromX?: number;
  fromY?: number;
}

const ONE_WAY_SLOP = 0.75;

/** True when a descending circle should land on this one-way tile. */
export function oneWayBlocksCircle(
  map: TileMap,
  tx: number,
  ty: number,
  x: number,
  y: number,
  radius: number,
  fromY: number,
): boolean {
  if (map.at(tx, ty) !== 'oneWay') return false;
  if (y < fromY - 1e-6) return false;
  const top = ty * map.tileSize;
  const prevBottom = fromY + radius;
  const nextBottom = y + radius;
  if (prevBottom > top + ONE_WAY_SLOP) return false;
  const tile = map.tileRect(tx, ty);
  return nextBottom > top && circleRectPenetration({ x, y, r: radius }, tile) !== null;
}

function tileBlocksCircle(
  map: TileMap,
  tx: number,
  ty: number,
  x: number,
  y: number,
  radius: number,
  allowMouseOnly: boolean,
  options?: TileCollisionOptions,
): boolean {
  if (map.blocked(tx, ty, allowMouseOnly)) {
    return circleRectPenetration({ x, y, r: radius }, map.tileRect(tx, ty)) !== null;
  }
  if (map.at(tx, ty) === 'oneWay' && options?.fromY !== undefined) {
    return oneWayBlocksCircle(map, tx, ty, x, y, radius, options.fromY);
  }
  return false;
}

/** True when a circle of `radius` at (x,y) overlaps any blocking tile. */
export function circleHitsTiles(
  map: TileMap,
  x: number,
  y: number,
  radius: number,
  allowMouseOnly: boolean,
  options?: TileCollisionOptions,
): boolean {
  const range = map.rectTileRange({
    x: x - radius,
    y: y - radius,
    w: radius * 2,
    h: radius * 2,
  });
  for (let ty = range.minY; ty <= range.maxY; ty += 1) {
    for (let tx = range.minX; tx <= range.maxX; tx += 1) {
      if (tileBlocksCircle(map, tx, ty, x, y, radius, allowMouseOnly, options)) return true;
    }
  }
  // Outside the map counts as blocked.
  if (x - radius < 0 || y - radius < 0 || x + radius > map.pixelWidth || y + radius > map.pixelHeight) {
    return true;
  }
  return false;
}

/**
 * Moves a circular body by (dx,dy) against the tile map, one axis at a time.
 * Long moves are substepped so fast bodies cannot tunnel through thin walls.
 */
export function moveCircle(
  map: TileMap,
  x: number,
  y: number,
  radius: number,
  dx: number,
  dy: number,
  allowMouseOnly: boolean,
): MoveResult {
  const startX = x;
  const startY = y;
  let hitX = false;
  let hitY = false;

  const maxStep = Math.max(1, radius * 0.75);
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let i = 0; i < steps; i += 1) {
    if (stepX !== 0) {
      const nx = x + stepX;
      if (circleHitsTiles(map, nx, y, radius, allowMouseOnly, { fromX: x, fromY: y })) {
        hitX = true;
      } else {
        x = nx;
      }
    }
    if (stepY !== 0) {
      const ny = y + stepY;
      if (circleHitsTiles(map, x, ny, radius, allowMouseOnly, { fromX: x, fromY: y })) {
        hitY = true;
      } else {
        y = ny;
      }
    }
  }

  return { x, y, hitX, hitY, traveled: Math.hypot(x - startX, y - startY) };
}

/** Pushes a body out of any tile it is already overlapping. */
export function resolveOverlap(
  map: TileMap,
  x: number,
  y: number,
  radius: number,
  allowMouseOnly: boolean,
  iterations = 4,
): Vec2 {
  let px = x;
  let py = y;
  for (let i = 0; i < iterations; i += 1) {
    let moved = false;
    const range = map.rectTileRange({ x: px - radius, y: py - radius, w: radius * 2, h: radius * 2 });
    for (let ty = range.minY; ty <= range.maxY; ty += 1) {
      for (let tx = range.minX; tx <= range.maxX; tx += 1) {
        if (!map.blocked(tx, ty, allowMouseOnly)) continue;
        const push = circleRectPenetration({ x: px, y: py, r: radius }, map.tileRect(tx, ty));
        if (!push) continue;
        px += push.x;
        py += push.y;
        moved = true;
      }
    }
    if (!moved) break;
  }
  px = clamp(px, radius, Math.max(radius, map.pixelWidth - radius));
  py = clamp(py, radius, Math.max(radius, map.pixelHeight - radius));
  return { x: px, y: py };
}

/** Advances a body with velocity and returns whether it collided. */
export function stepBody(map: TileMap, body: Body, dt: number): MoveResult {
  const result = moveCircle(map, body.x, body.y, body.radius, body.vx * dt, body.vy * dt, body.allowMouseOnly);
  body.x = result.x;
  body.y = result.y;
  if (result.hitX) body.vx = 0;
  if (result.hitY) body.vy = 0;
  return result;
}

export interface Trigger {
  readonly id: string;
  x: number;
  y: number;
  radius: number;
  enabled: boolean;
}

export function triggerHit(trigger: Trigger, x: number, y: number, radius: number): boolean {
  if (!trigger.enabled) return false;
  const rr = trigger.radius + radius;
  const dx = trigger.x - x;
  const dy = trigger.y - y;
  return dx * dx + dy * dy <= rr * rr;
}

/** Returns every enabled trigger overlapping the probe circle. */
export function queryTriggers(triggers: readonly Trigger[], x: number, y: number, radius: number): Trigger[] {
  const out: Trigger[] = [];
  for (const t of triggers) {
    if (triggerHit(t, x, y, radius)) out.push(t);
  }
  return out;
}

export function circlesOverlap(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx;
  const dy = ay - by;
  const rr = ar + br;
  return dx * dx + dy * dy <= rr * rr;
}

/**
 * Raycast in world space against blocking tiles. Returns the hit distance or
 * `maxDistance` when the ray is clear.
 */
export function raycastTiles(
  map: TileMap,
  originX: number,
  originY: number,
  dirX: number,
  dirY: number,
  maxDistance: number,
  allowMouseOnly = false,
): { hit: boolean; distance: number; x: number; y: number } {
  const len = Math.hypot(dirX, dirY);
  if (len < 1e-6) return { hit: false, distance: 0, x: originX, y: originY };
  const nx = dirX / len;
  const ny = dirY / len;
  const stepSize = Math.max(2, map.tileSize * 0.25);
  let traveled = 0;
  while (traveled < maxDistance) {
    traveled = Math.min(traveled + stepSize, maxDistance);
    const px = originX + nx * traveled;
    const py = originY + ny * traveled;
    if (map.blocked(map.toTileX(px), map.toTileY(py), allowMouseOnly)) {
      return { hit: true, distance: traveled, x: px, y: py };
    }
  }
  return { hit: false, distance: maxDistance, x: originX + nx * maxDistance, y: originY + ny * maxDistance };
}

/** Simple separation so two agents do not stack on the same pixel. */
export function separate(a: Body, b: Body, strength = 0.5): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const rr = a.radius + b.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq >= rr * rr || distSq < 1e-9) return;
  const dist = Math.sqrt(distSq);
  const overlap = (rr - dist) * strength;
  const ux = dx / dist;
  const uy = dy / dist;
  a.x -= ux * overlap;
  a.y -= uy * overlap;
  b.x += ux * overlap;
  b.y += uy * overlap;
}

export function aabbIntersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function aabbContains(a: Rect, x: number, y: number): boolean {
  return x >= a.x && x < a.x + a.w && y >= a.y && y < a.y + a.h;
}

/** Minimum translation that separates `a` from `b`, or null when they miss. */
export function aabbPenetration(a: Rect, b: Rect): Vec2 | null {
  if (!aabbIntersects(a, b)) return null;
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX < overlapY) {
    const aCenter = a.x + a.w / 2;
    const bCenter = b.x + b.w / 2;
    return { x: aCenter < bCenter ? -overlapX : overlapX, y: 0 };
  }
  const aCenter = a.y + a.h / 2;
  const bCenter = b.y + b.h / 2;
  return { x: 0, y: aCenter < bCenter ? -overlapY : overlapY };
}

export function oneWayBlocksAabb(map: TileMap, tx: number, ty: number, box: Rect, fromY: number): boolean {
  if (map.at(tx, ty) !== 'oneWay') return false;
  if (box.y < fromY - 1e-6) return false;
  const top = ty * map.tileSize;
  const prevBottom = fromY + box.h;
  const nextBottom = box.y + box.h;
  if (prevBottom > top + ONE_WAY_SLOP) return false;
  return aabbIntersects(box, map.tileRect(tx, ty)) && nextBottom > top;
}

function tileBlocksAabb(
  map: TileMap,
  tx: number,
  ty: number,
  box: Rect,
  allowMouseOnly: boolean,
  options?: TileCollisionOptions,
): boolean {
  if (map.blocked(tx, ty, allowMouseOnly)) return aabbIntersects(box, map.tileRect(tx, ty));
  if (map.at(tx, ty) === 'oneWay' && options?.fromY !== undefined) {
    return oneWayBlocksAabb(map, tx, ty, box, options.fromY);
  }
  return false;
}

export function aabbHitsTiles(
  map: TileMap,
  box: Rect,
  allowMouseOnly: boolean,
  options?: TileCollisionOptions,
): boolean {
  const range = map.rectTileRange(box);
  for (let ty = range.minY; ty <= range.maxY; ty += 1) {
    for (let tx = range.minX; tx <= range.maxX; tx += 1) {
      if (tileBlocksAabb(map, tx, ty, box, allowMouseOnly, options)) return true;
    }
  }
  if (box.x < 0 || box.y < 0 || box.x + box.w > map.pixelWidth || box.y + box.h > map.pixelHeight) {
    return true;
  }
  return false;
}

/**
 * Axis-separated AABB move against tiles, including one-way platforms.
 * `box.x/y` is the top-left corner.
 */
export function moveAabb(
  map: TileMap,
  box: Rect,
  dx: number,
  dy: number,
  allowMouseOnly: boolean,
): MoveResult {
  let x = box.x;
  let y = box.y;
  const startX = x;
  const startY = y;
  let hitX = false;
  let hitY = false;
  const maxStep = Math.max(1, Math.min(box.w, box.h) * 0.5);
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / maxStep));
  const stepX = dx / steps;
  const stepY = dy / steps;

  for (let i = 0; i < steps; i += 1) {
    if (stepX !== 0) {
      const nx = x + stepX;
      const next = { x: nx, y, w: box.w, h: box.h };
      if (aabbHitsTiles(map, next, allowMouseOnly, { fromX: x, fromY: y })) hitX = true;
      else x = nx;
    }
    if (stepY !== 0) {
      const ny = y + stepY;
      const next = { x, y: ny, w: box.w, h: box.h };
      if (aabbHitsTiles(map, next, allowMouseOnly, { fromX: x, fromY: y })) hitY = true;
      else y = ny;
    }
  }

  return { x, y, hitX, hitY, traveled: Math.hypot(x - startX, y - startY) };
}

export interface AabbBody {
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  allowMouseOnly: boolean;
}

export function stepAabb(map: TileMap, body: AabbBody, dt: number): MoveResult {
  const result = moveAabb(map, { x: body.x, y: body.y, w: body.w, h: body.h }, body.vx * dt, body.vy * dt, body.allowMouseOnly);
  body.x = result.x;
  body.y = result.y;
  if (result.hitX) body.vx = 0;
  if (result.hitY) body.vy = 0;
  return result;
}

export function resolveAabbOverlap(map: TileMap, box: Rect, allowMouseOnly: boolean, iterations = 4): Rect {
  let x = box.x;
  let y = box.y;
  for (let i = 0; i < iterations; i += 1) {
    let moved = false;
    const current = { x, y, w: box.w, h: box.h };
    const range = map.rectTileRange(current);
    for (let ty = range.minY; ty <= range.maxY; ty += 1) {
      for (let tx = range.minX; tx <= range.maxX; tx += 1) {
        if (!map.blocked(tx, ty, allowMouseOnly)) continue;
        const push = aabbPenetration(current, map.tileRect(tx, ty));
        if (!push) continue;
        x += push.x;
        y += push.y;
        current.x = x;
        current.y = y;
        moved = true;
      }
    }
    if (!moved) break;
  }
  x = clamp(x, 0, Math.max(0, map.pixelWidth - box.w));
  y = clamp(y, 0, Math.max(0, map.pixelHeight - box.h));
  return { x, y, w: box.w, h: box.h };
}

const DEFAULT_TRIGGER_KINDS = new Set(['hole', 'water', 'vent', 'grate', 'pipe', 'stairs']);

export interface TileTriggerHit {
  tx: number;
  ty: number;
  kind: TileKind;
}

/** Non-solid special tiles overlapping a circle — holes, water, vents, etc. */
export function queryTileTriggers(
  map: TileMap,
  x: number,
  y: number,
  radius: number,
  kinds: ReadonlySet<string> = DEFAULT_TRIGGER_KINDS,
): TileTriggerHit[] {
  const out: TileTriggerHit[] = [];
  const range = map.rectTileRange({ x: x - radius, y: y - radius, w: radius * 2, h: radius * 2 });
  for (let ty = range.minY; ty <= range.maxY; ty += 1) {
    for (let tx = range.minX; tx <= range.maxX; tx += 1) {
      const kind = map.at(tx, ty);
      if (!kinds.has(kind)) continue;
      if (circleRectPenetration({ x, y, r: radius }, map.tileRect(tx, ty))) {
        out.push({ tx, ty, kind });
      }
    }
  }
  return out;
}

export interface PhysicsWorldOptions {
  map: TileMap;
}

/**
 * Small registry of circular bodies and named triggers stepped together.
 * Gameplay systems can own their own arrays; this is the shared helper.
 */
export class PhysicsWorld {
  readonly map: TileMap;
  readonly bodies: Body[] = [];
  readonly triggers: Trigger[] = [];
  private nextTrigger = 1;

  constructor(options: PhysicsWorldOptions) {
    this.map = options.map;
  }

  addBody(body: Body): Body {
    this.bodies.push(body);
    return body;
  }

  removeBody(body: Body): boolean {
    const index = this.bodies.indexOf(body);
    if (index < 0) return false;
    this.bodies.splice(index, 1);
    return true;
  }

  addTrigger(init: Omit<Trigger, 'id' | 'enabled'> & { id?: string; enabled?: boolean }): Trigger {
    const trigger: Trigger = {
      id: init.id ?? `trigger-${this.nextTrigger++}`,
      x: init.x,
      y: init.y,
      radius: init.radius,
      enabled: init.enabled ?? true,
    };
    this.triggers.push(trigger);
    return trigger;
  }

  step(dt: number): MoveResult[] {
    const results: MoveResult[] = [];
    for (let i = 0; i < this.bodies.length; i += 1) {
      results.push(stepBody(this.map, this.bodies[i]!, dt));
    }
    for (let i = 0; i < this.bodies.length; i += 1) {
      for (let j = i + 1; j < this.bodies.length; j += 1) {
        separate(this.bodies[i]!, this.bodies[j]!);
      }
    }
    return results;
  }

  triggersAt(x: number, y: number, radius: number): Trigger[] {
    return queryTriggers(this.triggers, x, y, radius);
  }

  tileTriggersAt(x: number, y: number, radius: number): TileTriggerHit[] {
    return queryTileTriggers(this.map, x, y, radius);
  }
}

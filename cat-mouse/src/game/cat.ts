import { distance, rotateToward, wrapAngle } from '../engine/math';
import type { Entity, EventBusLike, Rng, ScentSampleLike, TileMapLike, Vec2 } from '../engine/types';
import type { CatRuntime, CatStats, CatWeights, DecoyRuntime, HoleRuntime, LightRuntime, MouseRuntime } from './types';
import { CAT_RADIUS, breedKit, cloneCatStats, cloneCatWeights } from './defaults';
import { catSpeedForState, setCatState, tickBrain, type BrainContext } from './brain';
import { findGridPath, nearestWalkable, pathToWorld } from './nav';
import { speedMultiplier, tickStatuses } from './status';
import { moveCircle } from './tiles';

export interface CatWorld {
  tiles: TileMapLike;
  mouse: MouseRuntime;
  scent: ScentSampleLike;
  lights: readonly LightRuntime[];
  decoys: DecoyRuntime[];
  holes: readonly HoleRuntime[];
  noise: { x: number; y: number; loudness: number } | null;
  events?: EventBusLike;
  rng: Rng;
  ambient: number;
  intensity?: number;
  hints: {
    ambushSpots: readonly Vec2[];
    searchSpots: readonly Vec2[];
    aggression: number;
    scentBias: number;
    hearingBias: number;
    campHoleChance: number;
    leashRadius: number;
  };
}

export interface CatStepResult {
  contact: boolean;
  state: CatRuntime['state'];
  spotted: boolean;
}

const REPATH_CHASE = 0.28;
const REPATH_IDLE = 0.48;
const ARRIVE = 0.32;

export function createCat(
  entity: Entity,
  x: number,
  y: number,
  breed = 'tabby',
  patrolRoute: Vec2[] = [],
  searchSpots: Vec2[] = [],
  stats?: CatStats,
  weights?: CatWeights,
): CatRuntime {
  const kit = breedKit(breed);
  return {
    entity,
    transform: { x, y, vx: 0, vy: 0, facing: 0, radius: CAT_RADIUS },
    state: 'patrol',
    breed: kit.id,
    stats: cloneCatStats(stats ?? kit.stats),
    weights: cloneCatWeights(weights ?? kit.weights),
    suspicion: 0,
    stateTimer: 0,
    pounceCooldown: 0,
    frozen: 0,
    target: null,
    lastKnown: null,
    memoryTimer: 0,
    patrolRoute: patrolRoute.length > 0 ? patrolRoute.map((p) => ({ x: p.x, y: p.y })) : [{ x, y }],
    patrolIndex: 0,
    path: [],
    pathIndex: 0,
    repathTimer: 0,
    searchSpots: searchSpots.map((p) => ({ x: p.x, y: p.y })),
    homeX: x,
    homeY: y,
    statuses: [],
  };
}

export function catSpeed(cat: CatRuntime, intensity = 0): number {
  return Math.max(0, catSpeedForState(cat, intensity) * speedMultiplier(cat.statuses));
}

export function repathTo(cat: CatRuntime, tiles: TileMapLike, goal: Vec2, force = false): boolean {
  if (!force && cat.repathTimer > 0 && cat.path.length > 0) return false;
  const start = nearestWalkable(tiles, cat.transform.x, cat.transform.y, false);
  const end = nearestWalkable(tiles, goal.x, goal.y, false);
  const result = findGridPath(tiles, start, end, false);
  cat.repathTimer = cat.state === 'chase' ? REPATH_CHASE : REPATH_IDLE;
  if (!result.found || result.nodes.length === 0) {
    cat.path = [{ x: goal.x, y: goal.y }];
    cat.pathIndex = 0;
    return false;
  }
  cat.path = pathToWorld(result.nodes);
  cat.pathIndex = cat.path.length > 1 ? 1 : 0;
  return true;
}

export function followPath(cat: CatRuntime, tiles: TileMapLike, dt: number, speed: number): boolean {
  if (cat.path.length === 0) return true;
  let node = cat.path[cat.pathIndex];
  while (node && distance(cat.transform.x, cat.transform.y, node.x, node.y) <= ARRIVE) {
    cat.pathIndex += 1;
    node = cat.path[cat.pathIndex];
  }
  if (!node) {
    cat.path = [];
    cat.pathIndex = 0;
    cat.transform.vx = 0;
    cat.transform.vy = 0;
    return true;
  }
  steerTo(cat, tiles, node.x, node.y, dt, speed);
  return false;
}

export function steerTo(
  cat: CatRuntime,
  tiles: TileMapLike,
  targetX: number,
  targetY: number,
  dt: number,
  speed: number,
): void {
  const t = cat.transform;
  const dx = targetX - t.x;
  const dy = targetY - t.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-5 || speed <= 0) {
    t.vx = 0;
    t.vy = 0;
    return;
  }
  const ux = dx / len;
  const uy = dy / len;
  const turn = cat.state === 'pounce' ? cat.stats.turnRate * 2.2 : cat.stats.turnRate;
  t.facing = rotateToward(t.facing, wrapAngle(Math.atan2(uy, ux)), turn * dt);
  t.vx = ux * speed;
  t.vy = uy * speed;
  const moved = moveCircle(t.x, t.y, t.vx, t.vy, t.radius, dt, tiles, false);
  if (moved.hit && Math.hypot(moved.x - t.x, moved.y - t.y) < speed * dt * 0.2) {
    const slideX = moveCircle(t.x, t.y, t.vx, 0, t.radius, dt, tiles, false);
    const slideY = moveCircle(t.x, t.y, 0, t.vy, t.radius, dt, tiles, false);
    if (Math.abs(slideX.x - t.x) >= Math.abs(slideY.y - t.y)) {
      t.x = slideX.x;
      t.y = slideX.y;
    } else {
      t.x = slideY.x;
      t.y = slideY.y;
    }
    return;
  }
  t.x = moved.x;
  t.y = moved.y;
}

/** Locked-direction lunge used while the brain is in `pounce`. */
export function pounceLunge(cat: CatRuntime, tiles: TileMapLike, dt: number): void {
  const target = cat.target ?? cat.lastKnown;
  if (!target) return;
  steerTo(cat, tiles, target.x, target.y, dt, cat.stats.pounceSpeed * speedMultiplier(cat.statuses));
}

export function toBrainContext(cat: CatRuntime, world: CatWorld, dt: number): BrainContext {
  return {
    cat,
    mouse: world.mouse,
    tiles: world.tiles,
    scent: world.scent,
    decoys: world.decoys,
    holes: world.holes as HoleRuntime[],
    lights: world.lights as LightRuntime[],
    dt,
    rng: world.rng,
    events: world.events,
    intensity: world.intensity ?? 0,
    aggression: world.hints.aggression,
    scentBias: world.hints.scentBias,
    hearingBias: world.hints.hearingBias,
    campHoleChance: world.hints.campHoleChance,
    leashRadius: world.hints.leashRadius,
    ambushSpots: world.hints.ambushSpots.map((s) => ({ x: s.x, y: s.y })),
    searchSpots: world.hints.searchSpots.map((s) => ({ x: s.x, y: s.y })),
    noise: world.noise ? { x: world.noise.x, y: world.noise.y, loudness: world.noise.loudness, age: 0 } : null,
    ambient: world.ambient,
  };
}

export function catStep(cat: CatRuntime, world: CatWorld, dt: number): CatStepResult {
  tickStatuses(cat.statuses, dt);
  if (cat.repathTimer > 0) cat.repathTimer = Math.max(0, cat.repathTimer - dt);

  tickBrain(toBrainContext(cat, world, dt));

  const t = cat.transform;
  if (cat.frozen > 0 || cat.state === 'nap' || cat.state === 'groom') {
    t.vx = 0;
    t.vy = 0;
    return { contact: false, state: cat.state, spotted: cat.state === 'chase' || cat.state === 'pounce' };
  }

  if (cat.state === 'suspicious') {
    t.vx = 0;
    t.vy = 0;
    const look = cat.lastKnown ?? world.noise;
    if (look) {
      t.facing = rotateToward(t.facing, wrapAngle(Math.atan2(look.y - t.y, look.x - t.x)), cat.stats.turnRate * dt);
    }
    return { contact: false, state: cat.state, spotted: false };
  }

  if (cat.state === 'pounce') {
    pounceLunge(cat, world.tiles, dt);
  } else {
    const speed = catSpeed(cat, world.intensity ?? 0);
    const goal = cat.target;
    if (goal) {
      const interval = cat.state === 'chase' ? REPATH_CHASE : REPATH_IDLE;
      if (cat.repathTimer <= 0 || cat.path.length === 0) {
        repathTo(cat, world.tiles, goal, true);
        cat.repathTimer = interval;
      }
      if (followPath(cat, world.tiles, dt, speed)) {
        steerTo(cat, world.tiles, goal.x, goal.y, dt, speed);
      }
    } else {
      t.vx = 0;
      t.vy = 0;
    }
  }

  const reach = t.radius + world.mouse.transform.radius;
  const contact = distance(t.x, t.y, world.mouse.transform.x, world.mouse.transform.y) <= reach;
  const spotted = cat.state === 'chase' || cat.state === 'pounce';
  return { contact, state: cat.state, spotted };
}

export function freezeCat(cat: CatRuntime, seconds: number): void {
  cat.frozen = Math.max(cat.frozen, seconds);
  cat.transform.vx = 0;
  cat.transform.vy = 0;
  cat.path = [];
  cat.pathIndex = 0;
}

export function distractCats(cats: CatRuntime[], x: number, y: number, strength = 1): void {
  for (const cat of cats) {
    cat.lastKnown = { x, y };
    cat.suspicion = Math.max(cat.suspicion, Math.min(1, 0.55 * strength));
    cat.path = [];
    cat.repathTimer = 0;
    if (cat.state === 'patrol' || cat.state === 'nap' || cat.state === 'groom' || cat.state === 'ambush') {
      setCatState(cat, 'investigate');
    }
  }
}

export function catStateLabel(state: CatRuntime['state']): string {
  switch (state) {
    case 'suspicious':
      return 'hmm?';
    case 'investigate':
      return 'checking';
    case 'chase':
      return 'chasing';
    case 'pounce':
      return 'pouncing';
    case 'search':
      return 'searching';
    case 'ambush':
      return 'waiting';
    case 'groom':
      return 'grooming';
    case 'nap':
      return 'napping';
    case 'return':
      return 'returning';
    default:
      return 'patrol';
  }
}

export function defaultCatHints(): CatWorld['hints'] {
  return {
    ambushSpots: [],
    searchSpots: [],
    aggression: 1,
    scentBias: 1,
    hearingBias: 1,
    campHoleChance: 0.08,
    leashRadius: 22,
  };
}

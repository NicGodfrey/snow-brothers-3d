import { clamp01, distance } from '../engine/math';
import type { EventBusLike, Rng, ScentSampleLike, TileMapLike, Vec2 } from '../engine/types';
import type {
  CatRuntime,
  CatState,
  DecoyRuntime,
  HoleRuntime,
  LightRuntime,
  MouseRuntime,
} from './types';
import { senseDecoy, senseMouse } from './senses';
import { canAct } from './status';

export interface BrainContext {
  cat: CatRuntime;
  mouse: MouseRuntime;
  tiles: TileMapLike;
  scent: ScentSampleLike;
  decoys: DecoyRuntime[];
  holes: HoleRuntime[];
  lights: LightRuntime[];
  dt: number;
  rng: Rng;
  events?: EventBusLike;
  intensity: number;
  aggression: number;
  scentBias: number;
  hearingBias: number;
  campHoleChance: number;
  leashRadius: number;
  ambushSpots: Vec2[];
  searchSpots: Vec2[];
  noise: { x: number; y: number; loudness: number; age: number } | null;
  ambient: number;
}

export function setCatState(cat: CatRuntime, next: CatState, events?: EventBusLike): boolean {
  if (cat.state === next) return false;
  const from = cat.state;
  cat.state = next;
  cat.stateTimer = 0;
  if (next === 'pounce') cat.pounceCooldown = cat.stats.pounceCooldown;
  if (next === 'search' && cat.searchSpots.length === 0 && cat.lastKnown) {
    cat.searchSpots = scatter(cat.lastKnown, 4);
  }
  events?.emit('cat:stateChange', { from, to: next, breed: cat.breed });
  if (next === 'chase' && from !== 'pounce') {
    events?.emit('cat:spotted', { x: cat.transform.x, y: cat.transform.y });
  }
  if (from === 'chase' && next !== 'pounce' && next !== 'chase') {
    events?.emit('cat:lost', { x: cat.transform.x, y: cat.transform.y });
  }
  return true;
}

function scatter(origin: Vec2, count: number): Vec2[] {
  const spots: Vec2[] = [];
  for (let i = 0; i < count; i += 1) {
    const a = (i / count) * Math.PI * 2 + 0.4;
    spots.push({ x: origin.x + Math.cos(a) * 2.2, y: origin.y + Math.sin(a) * 2.2 });
  }
  return spots;
}

function aimAt(cat: CatRuntime, x: number, y: number): void {
  cat.target = { x, y };
}

function clearPath(cat: CatRuntime): void {
  cat.path = [];
  cat.pathIndex = 0;
  cat.repathTimer = 0;
}

function distTo(cat: CatRuntime, x: number, y: number): number {
  return distance(cat.transform.x, cat.transform.y, x, y);
}

function patrolPoint(cat: CatRuntime): Vec2 {
  if (cat.patrolRoute.length === 0) return { x: cat.homeX, y: cat.homeY };
  const point = cat.patrolRoute[cat.patrolIndex % cat.patrolRoute.length];
  return point ?? { x: cat.homeX, y: cat.homeY };
}

function advancePatrol(cat: CatRuntime): void {
  if (cat.patrolRoute.length === 0) return;
  cat.patrolIndex = (cat.patrolIndex + 1) % cat.patrolRoute.length;
}

function pickWeighted(
  rng: Rng,
  options: { state: CatState; weight: number }[],
): CatState | null {
  const live = options.filter((o) => o.weight > 0);
  if (live.length === 0) return null;
  return rng.weighted(live, (o) => o.weight).state;
}

function leashBreak(ctx: BrainContext): boolean {
  if (ctx.leashRadius <= 0) return false;
  const busy = ctx.cat.state === 'chase' || ctx.cat.state === 'pounce' || ctx.cat.state === 'investigate';
  if (busy) return false;
  return distTo(ctx.cat, ctx.cat.homeX, ctx.cat.homeY) > ctx.leashRadius;
}

/**
 * Perception + finite state machine. Sets `cat.target` / `cat.state`;
 * locomotion lives in `cat.ts`.
 */
export function tickBrain(ctx: BrainContext): CatState {
  const { cat, mouse, dt, rng } = ctx;
  cat.stateTimer += dt;
  if (cat.pounceCooldown > 0) cat.pounceCooldown = Math.max(0, cat.pounceCooldown - dt);
  if (cat.frozen > 0) {
    cat.frozen = Math.max(0, cat.frozen - dt);
    return cat.state;
  }
  if (!canAct(cat.statuses)) return cat.state;

  const sense = senseMouse(
    cat,
    mouse,
    ctx.tiles,
    ctx.scent,
    ctx.lights,
    ctx.noise,
    ctx.hearingBias,
    ctx.scentBias,
    ctx.ambient,
  );
  const decoySense = senseDecoy(cat, ctx.decoys, ctx.hearingBias);
  const agg = ctx.aggression;

  let spotted = sense.visible || sense.peripheral;
  if (sense.peripheral && rng.next() > 0.55 + cat.stats.suspicionGain * 0.1) spotted = false;

  if (spotted) {
    cat.lastKnown = { x: mouse.transform.x, y: mouse.transform.y };
    cat.memoryTimer = cat.stats.memorySeconds;
    cat.suspicion = 1;
  } else if (cat.memoryTimer > 0) {
    cat.memoryTimer = Math.max(0, cat.memoryTimer - dt);
  }

  const decoy = decoySense.decoy;
  const heard = Math.max(sense.hearing, decoySense.hearing);
  if (decoy && decoySense.hearing > 0.12 && !spotted) {
    decoy.attracted = true;
    cat.lastKnown = { x: decoy.x, y: decoy.y };
    cat.suspicion = clamp01(cat.suspicion + cat.stats.suspicionGain * decoySense.hearing * dt * 1.4);
  } else if (heard > 0.1 && !spotted) {
    const nx = ctx.noise ? ctx.noise.x : mouse.transform.x;
    const ny = ctx.noise ? ctx.noise.y : mouse.transform.y;
    cat.lastKnown = { x: nx, y: ny };
    cat.suspicion = clamp01(cat.suspicion + cat.stats.suspicionGain * heard * dt * agg);
  } else if (sense.scent > 0.22 && !spotted) {
    const gx = sense.scentDir.x;
    const gy = sense.scentDir.y;
    const glen = Math.hypot(gx, gy);
    if (glen > 0.05) {
      cat.lastKnown = {
        x: cat.transform.x + (gx / glen) * 1.4,
        y: cat.transform.y + (gy / glen) * 1.4,
      };
    }
    cat.suspicion = clamp01(cat.suspicion + cat.stats.suspicionGain * 0.35 * dt);
  } else if (!spotted) {
    cat.suspicion = clamp01(cat.suspicion - cat.stats.suspicionDecay * dt);
  }

  if (leashBreak(ctx)) {
    setCatState(cat, 'return', ctx.events);
    aimAt(cat, cat.homeX, cat.homeY);
    return cat.state;
  }

  const pounceReady = cat.pounceCooldown <= 0;
  const close = distTo(cat, mouse.transform.x, mouse.transform.y) <= cat.stats.pounceRange;

  switch (cat.state) {
    case 'patrol':
      tickPatrol(ctx, spotted, heard, close, pounceReady);
      break;
    case 'suspicious':
      tickSuspicious(ctx, spotted, heard, close, pounceReady);
      break;
    case 'investigate':
      tickInvestigate(ctx, spotted, heard, close, pounceReady);
      break;
    case 'chase':
      tickChase(ctx, spotted, close, pounceReady);
      break;
    case 'pounce':
      tickPounce(ctx, spotted);
      break;
    case 'search':
      tickSearch(ctx, spotted, heard, close, pounceReady);
      break;
    case 'ambush':
      tickAmbush(ctx, spotted, heard, close, pounceReady);
      break;
    case 'groom':
      tickIdle(ctx, spotted, heard, 'groom', 2.2);
      break;
    case 'nap':
      tickNap(ctx, spotted, heard);
      break;
    case 'return':
      tickReturn(ctx, spotted, heard, close, pounceReady);
      break;
    default:
      setCatState(cat, 'patrol', ctx.events);
      break;
  }
  return cat.state;
}

function goAlert(ctx: BrainContext, spotted: boolean, close: boolean, pounceReady: boolean): boolean {
  const { cat } = ctx;
  if (spotted && close && pounceReady) {
    setCatState(cat, 'pounce', ctx.events);
    aimAt(cat, ctx.mouse.transform.x + ctx.mouse.transform.vx * 0.18, ctx.mouse.transform.y + ctx.mouse.transform.vy * 0.18);
    clearPath(cat);
    return true;
  }
  if (spotted) {
    setCatState(cat, 'chase', ctx.events);
    aimAt(cat, ctx.mouse.transform.x, ctx.mouse.transform.y);
    return true;
  }
  return false;
}

function tickPatrol(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  close: boolean,
  pounceReady: boolean,
): void {
  const { cat, rng } = ctx;
  if (goAlert(ctx, spotted, close, pounceReady)) return;
  if (heard > 0.22 || cat.suspicion > 0.38) {
    setCatState(cat, cat.suspicion > 0.62 ? 'investigate' : 'suspicious', ctx.events);
    if (cat.lastKnown) aimAt(cat, cat.lastKnown.x, cat.lastKnown.y);
    return;
  }
  const point = patrolPoint(cat);
  aimAt(cat, point.x, point.y);
  if (distTo(cat, point.x, point.y) < 0.35) {
    advancePatrol(cat);
    const next = pickWeighted(rng, [
      { state: 'patrol', weight: cat.weights.patrol },
      { state: 'ambush', weight: cat.weights.ambush * (ctx.intensity < 0.45 ? 1 : 0.4) },
      { state: 'nap', weight: cat.stats.napChance * cat.weights.nap * Math.max(0.05, 1.15 - ctx.intensity) },
      { state: 'groom', weight: 0.18 * (1 - ctx.intensity) },
    ]);
    if (next && next !== 'patrol') {
      if (next === 'ambush') startAmbush(ctx);
      else setCatState(cat, next, ctx.events);
    }
    if (rng.next() < ctx.campHoleChance * cat.weights.camp && ctx.holes.length > 0) {
      const hole = rng.pick(ctx.holes);
      cat.searchSpots = [{ x: hole.x, y: hole.y }];
      startAmbush(ctx, { x: hole.x, y: hole.y });
    }
  }
}

function startAmbush(ctx: BrainContext, spot?: Vec2): void {
  const { cat, rng } = ctx;
  const fromHints = ctx.ambushSpots;
  const chosen =
    spot ??
    (fromHints.length > 0 ? rng.pick(fromHints) : { x: cat.homeX, y: cat.homeY });
  setCatState(cat, 'ambush', ctx.events);
  aimAt(cat, chosen.x, chosen.y);
  clearPath(cat);
}

function tickSuspicious(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  close: boolean,
  pounceReady: boolean,
): void {
  const { cat } = ctx;
  if (goAlert(ctx, spotted, close, pounceReady)) return;
  if (cat.lastKnown) {
    const dx = cat.lastKnown.x - cat.transform.x;
    const dy = cat.lastKnown.y - cat.transform.y;
    if (Math.hypot(dx, dy) > 0.05) cat.transform.facing = Math.atan2(dy, dx);
  }
  cat.target = null;
  if (heard > 0.28 || cat.suspicion > 0.7) {
    setCatState(cat, 'investigate', ctx.events);
    if (cat.lastKnown) aimAt(cat, cat.lastKnown.x, cat.lastKnown.y);
    return;
  }
  if (cat.stateTimer > 1.35 && cat.suspicion < 0.35) setCatState(cat, 'patrol', ctx.events);
}

function tickInvestigate(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  close: boolean,
  pounceReady: boolean,
): void {
  const { cat } = ctx;
  if (goAlert(ctx, spotted, close, pounceReady)) return;
  if (cat.lastKnown) aimAt(cat, cat.lastKnown.x, cat.lastKnown.y);
  if (cat.target && distTo(cat, cat.target.x, cat.target.y) < 0.4) {
    setCatState(cat, 'search', ctx.events);
    return;
  }
  if (cat.stateTimer > 5 || (heard < 0.05 && cat.suspicion < 0.2 && cat.stateTimer > 2.2)) {
    setCatState(cat, 'search', ctx.events);
  }
}

function tickChase(ctx: BrainContext, spotted: boolean, close: boolean, pounceReady: boolean): void {
  const { cat, mouse } = ctx;
  if (spotted) {
    cat.lastKnown = { x: mouse.transform.x, y: mouse.transform.y };
    cat.memoryTimer = cat.stats.memorySeconds;
    aimAt(cat, mouse.transform.x, mouse.transform.y);
    if (close && pounceReady) {
      setCatState(cat, 'pounce', ctx.events);
      aimAt(cat, mouse.transform.x + mouse.transform.vx * 0.2, mouse.transform.y + mouse.transform.vy * 0.2);
      clearPath(cat);
    }
    return;
  }
  if (cat.lastKnown) aimAt(cat, cat.lastKnown.x, cat.lastKnown.y);
  if (cat.memoryTimer <= 0) setCatState(cat, 'search', ctx.events);
}

function tickPounce(ctx: BrainContext, spotted: boolean): void {
  const { cat } = ctx;
  if (!cat.target && cat.lastKnown) aimAt(cat, cat.lastKnown.x, cat.lastKnown.y);
  if (cat.stateTimer > 0.38) {
    if (spotted) setCatState(cat, 'chase', ctx.events);
    else setCatState(cat, 'search', ctx.events);
  }
}

function tickSearch(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  close: boolean,
  pounceReady: boolean,
): void {
  const { cat, rng } = ctx;
  if (goAlert(ctx, spotted, close, pounceReady)) return;
  if (heard > 0.3) {
    setCatState(cat, 'investigate', ctx.events);
    return;
  }
  if (cat.searchSpots.length === 0) {
    const base = cat.lastKnown ?? { x: cat.homeX, y: cat.homeY };
    cat.searchSpots = ctx.searchSpots.length > 0 ? ctx.searchSpots.map((s) => ({ ...s })) : scatter(base, 5);
    if (ctx.searchSpots.length > 0) rng.shuffle(cat.searchSpots);
  }
  const spot = cat.searchSpots[0];
  if (!spot) {
    setCatState(cat, 'return', ctx.events);
    return;
  }
  aimAt(cat, spot.x, spot.y);
  if (distTo(cat, spot.x, spot.y) < 0.4) cat.searchSpots.shift();
  if (cat.stateTimer > cat.stats.searchSeconds) setCatState(cat, 'return', ctx.events);
}

function tickAmbush(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  close: boolean,
  pounceReady: boolean,
): void {
  const { cat } = ctx;
  if (goAlert(ctx, spotted, close, pounceReady)) return;
  if (heard > 0.45) {
    setCatState(cat, 'investigate', ctx.events);
    return;
  }
  if (cat.target && distTo(cat, cat.target.x, cat.target.y) > 0.45) return;
  cat.target = cat.target ?? { x: cat.transform.x, y: cat.transform.y };
  if (cat.stateTimer > 7.5) setCatState(cat, 'patrol', ctx.events);
}

function tickIdle(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  _kind: CatState,
  duration: number,
): void {
  const { cat } = ctx;
  cat.target = null;
  if (goAlert(ctx, spotted, false, cat.pounceCooldown <= 0)) return;
  if (heard > 0.35) {
    setCatState(cat, 'suspicious', ctx.events);
    return;
  }
  if (cat.stateTimer > duration) setCatState(cat, 'patrol', ctx.events);
}

function tickNap(ctx: BrainContext, spotted: boolean, heard: number): void {
  const { cat } = ctx;
  cat.target = null;
  if (goAlert(ctx, spotted, false, cat.pounceCooldown <= 0)) return;
  if (heard > 0.55) {
    cat.suspicion = clamp01(cat.suspicion + 0.4);
    setCatState(cat, 'suspicious', ctx.events);
    return;
  }
  if (cat.stateTimer > 4.5 + cat.stats.napChance * 4) setCatState(cat, 'groom', ctx.events);
}

function tickReturn(
  ctx: BrainContext,
  spotted: boolean,
  heard: number,
  close: boolean,
  pounceReady: boolean,
): void {
  const { cat } = ctx;
  if (goAlert(ctx, spotted, close, pounceReady)) return;
  if (heard > 0.35) {
    setCatState(cat, 'investigate', ctx.events);
    return;
  }
  const point = cat.patrolRoute[0] ?? { x: cat.homeX, y: cat.homeY };
  aimAt(cat, point.x, point.y);
  if (distTo(cat, point.x, point.y) < 0.4) {
    cat.patrolIndex = 0;
    setCatState(cat, 'patrol', ctx.events);
  }
}

export function catSpeedForState(cat: CatRuntime, intensity = 0): number {
  const boost = 1 + intensity * 0.12;
  switch (cat.state) {
    case 'chase':
      return cat.stats.chaseSpeed * boost;
    case 'pounce':
      return cat.stats.pounceSpeed;
    case 'investigate':
    case 'search':
      return cat.stats.investigateSpeed * boost;
    case 'return':
    case 'patrol':
    case 'ambush':
      return cat.stats.patrolSpeed;
    case 'suspicious':
      return cat.stats.patrolSpeed * 0.2;
    default:
      return 0;
  }
}

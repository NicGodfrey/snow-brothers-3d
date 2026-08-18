import { clamp, distance, wrapAngle } from '../engine/math';
import type { Entity, EventBusLike, InputSnapshot, Rng, TileMapLike } from '../engine/types';
import type {
  CatRuntime,
  CheeseRuntime,
  DecoyRuntime,
  DoorRuntime,
  HoleRuntime,
  LightRuntime,
  MouseRuntime,
  MouseStats,
  PowerUpRuntime,
  ScoreState,
  SwitchRuntime,
} from './types';
import {
  CATCH_INVULN,
  DEFAULT_MOUSE_STATS,
  INTERACT_RADIUS,
  MOUSE_RADIUS,
  NOISE_EMIT_THRESHOLD,
  PICKUP_RADIUS,
  SCENT_IDLE,
} from './defaults';
import {
  applyStatus,
  canAct,
  hasStatus,
  isInvulnerable,
  makeStatus,
  noiseMultiplier,
  scentMultiplier,
  speedMultiplier,
  tickStatuses,
} from './status';
import { mouseHiddenAt, moveCircle, propsAtWorld } from './tiles';
import { dropCarriedCheese, tickMagnet, tryPickupCheese } from './cheese';
import { tryUseHole } from './holes';
import { tryPickupPowerUp, usePowerUp } from './powerups';
import { setCarried, createScoreState } from './score';

export interface MouseWorld {
  tiles: TileMapLike;
  cheeses: CheeseRuntime[];
  holes: HoleRuntime[];
  powerUps: PowerUpRuntime[];
  switches: SwitchRuntime[];
  doors: DoorRuntime[];
  lights: LightRuntime[];
  decoys: DecoyRuntime[];
  cats: CatRuntime[];
  keys: { entity: Entity; x: number; y: number; keyId: string; taken: boolean }[];
  crumbs: { entity: Entity; x: number; y: number; taken: boolean }[];
  score: ScoreState;
  events?: EventBusLike;
  rng: Rng;
  allocateEntity: () => Entity;
  setDoorOpen?: (tx: number, ty: number, open: boolean) => void;
}

let nextDummyEntity = 1000;

export function emptyMouseWorld(
  tiles: TileMapLike,
  rng: Rng,
  events?: EventBusLike,
): MouseWorld {
  return {
    tiles,
    cheeses: [],
    holes: [],
    powerUps: [],
    switches: [],
    doors: [],
    lights: [],
    decoys: [],
    cats: [],
    keys: [],
    crumbs: [],
    score: createScoreState(3),
    events,
    rng,
    allocateEntity: () => {
      nextDummyEntity += 1;
      return nextDummyEntity;
    },
  };
}

export interface MouseStepResult {
  noise: number;
  scent: number;
  moved: boolean;
  interacted: boolean;
}

export function createMouse(
  entity: Entity,
  x: number,
  y: number,
  stats: MouseStats = DEFAULT_MOUSE_STATS,
  lives = 3,
): MouseRuntime {
  return {
    entity,
    transform: { x, y, vx: 0, vy: 0, facing: 0, radius: MOUSE_RADIUS },
    stance: 'idle',
    stats,
    stamina: stats.staminaMax,
    dashTimer: 0,
    dashCooldown: 0,
    invulnerable: 0,
    carrying: 0,
    // Below the usual stage quota on purpose: the mouse has to ferry cheese to
    // a hole in more than one trip, which is where the risk lives.
    carryCapacity: 2,
    crumbs: 2,
    keys: [],
    heldPowerUp: null,
    lives,
    spawnX: x,
    spawnY: y,
    lastNoise: 0,
    statuses: [],
  };
}

export function mouseSpeed(mouse: MouseRuntime): number {
  const stats = mouse.stats;
  let speed = stats.walkSpeed;
  if (mouse.stance === 'sneak') speed = stats.sneakSpeed;
  if (mouse.stance === 'dash') speed = stats.dashSpeed;
  const carry = mouse.carryCapacity > 0 ? mouse.carrying / mouse.carryCapacity : 0;
  speed *= 1 - stats.carryPenalty * carry;
  speed *= speedMultiplier(mouse.statuses);
  return Math.max(0, speed);
}

function axisOf(input: InputSnapshot): { x: number; y: number } {
  let x = input.axisX;
  let y = input.axisY;
  if (input.down('left')) x -= 1;
  if (input.down('right')) x += 1;
  if (input.down('up')) y -= 1;
  if (input.down('down')) y += 1;
  const len = Math.hypot(x, y);
  if (len > 1) return { x: x / len, y: y / len };
  return { x, y };
}

export function tryDash(mouse: MouseRuntime, dirX: number, dirY: number): boolean {
  if (mouse.dashTimer > 0 || mouse.dashCooldown > 0) return false;
  if (mouse.stamina < mouse.stats.staminaDashCost) return false;
  if (!canAct(mouse.statuses) || mouse.stance === 'caught') return false;
  if (hasStatus(mouse.statuses, 'exhausted')) return false;
  const len = Math.hypot(dirX, dirY);
  const ux = len > 1e-6 ? dirX / len : Math.cos(mouse.transform.facing);
  const uy = len > 1e-6 ? dirY / len : Math.sin(mouse.transform.facing);
  mouse.stamina = Math.max(0, mouse.stamina - mouse.stats.staminaDashCost);
  mouse.dashTimer = mouse.stats.dashSeconds;
  mouse.dashCooldown = mouse.stats.dashCooldown;
  mouse.stance = 'dash';
  mouse.transform.vx = ux * mouse.stats.dashSpeed;
  mouse.transform.vy = uy * mouse.stats.dashSpeed;
  mouse.transform.facing = wrapAngle(Math.atan2(uy, ux));
  return true;
}

export function dropDecoy(
  mouse: MouseRuntime,
  decoys: DecoyRuntime[],
  allocateEntity: () => Entity,
  events?: EventBusLike,
  noise = 2.2,
  life = 6,
): DecoyRuntime | null {
  if (mouse.crumbs <= 0 || mouse.stance === 'caught') return null;
  mouse.crumbs -= 1;
  const decoy: DecoyRuntime = {
    entity: allocateEntity(),
    x: mouse.transform.x,
    y: mouse.transform.y,
    life,
    noise,
    attracted: false,
  };
  decoys.push(decoy);
  events?.emit('mouse:noise', { x: decoy.x, y: decoy.y, loudness: noise });
  return decoy;
}

function pickupLoose(mouse: MouseRuntime, world: MouseWorld): void {
  for (let i = 0; i < world.keys.length; i += 1) {
    const key = world.keys[i]!;
    if (key.taken) continue;
    if (distance(key.x, key.y, mouse.transform.x, mouse.transform.y) > PICKUP_RADIUS) continue;
    key.taken = true;
    if (!mouse.keys.includes(key.keyId)) mouse.keys.push(key.keyId);
  }
  for (let i = 0; i < world.crumbs.length; i += 1) {
    const crumb = world.crumbs[i]!;
    if (crumb.taken) continue;
    if (distance(crumb.x, crumb.y, mouse.transform.x, mouse.transform.y) > PICKUP_RADIUS) continue;
    crumb.taken = true;
    mouse.crumbs += 1;
  }
}

function tryDoor(mouse: MouseRuntime, world: MouseWorld): boolean {
  for (let i = 0; i < world.doors.length; i += 1) {
    const door = world.doors[i]!;
    if (distance(door.x, door.y, mouse.transform.x, mouse.transform.y) > INTERACT_RADIUS + 0.2) continue;
    if (door.locked) {
      const idx = mouse.keys.indexOf(door.keyId);
      if (idx < 0) continue;
      mouse.keys.splice(idx, 1);
      door.locked = false;
      door.open = true;
    } else {
      door.open = !door.open;
    }
    world.setDoorOpen?.(Math.floor(door.x), Math.floor(door.y), door.open);
    return true;
  }
  return false;
}

function trySwitch(mouse: MouseRuntime, world: MouseWorld): boolean {
  for (let i = 0; i < world.switches.length; i += 1) {
    const sw = world.switches[i]!;
    if (distance(sw.x, sw.y, mouse.transform.x, mouse.transform.y) > INTERACT_RADIUS) continue;
    sw.on = !sw.on;
    applySwitch(sw, world);
    return true;
  }
  return false;
}

export function applySwitch(sw: SwitchRuntime, world: MouseWorld): void {
  for (let i = 0; i < world.lights.length; i += 1) {
    const light = world.lights[i]!;
    if (light.switchId && sw.targets.includes(light.switchId)) light.on = sw.on;
    if (light.switchId === sw.id) light.on = sw.on;
  }
  for (let i = 0; i < world.doors.length; i += 1) {
    const door = world.doors[i]!;
    if (sw.targets.includes(door.id) && !door.locked) {
      door.open = sw.kind === 'door' ? sw.on : door.open;
      world.setDoorOpen?.(Math.floor(door.x), Math.floor(door.y), door.open);
    }
  }
}

export function interact(mouse: MouseRuntime, world: MouseWorld): boolean {
  if (!canAct(mouse.statuses) || mouse.stance === 'caught') return false;
  const cheese = tryPickupCheese(mouse, world.cheeses, world.events, world.cats);
  if (cheese) {
    setCarried(world.score, mouse.carrying);
    return true;
  }
  if (trySwitch(mouse, world)) return true;
  if (tryDoor(mouse, world)) return true;
  const hole = tryUseHole(mouse, world.holes, world.score, world.events);
  if (hole.banked > 0 || hole.teleported) {
    setCarried(world.score, mouse.carrying);
    return true;
  }
  return false;
}

export function catchMouse(
  mouse: MouseRuntime,
  world: MouseWorld,
  atX: number,
  atY: number,
): boolean {
  if (mouse.invulnerable > 0 || isInvulnerable(mouse.statuses)) return false;
  if (mouse.stance === 'caught') return false;
  if (mouseHiddenAt(world.tiles, mouse.transform.x, mouse.transform.y)) return false;
  mouse.lives -= 1;
  mouse.stance = 'caught';
  dropCarriedCheese(mouse, world.cheeses, world.allocateEntity);
  setCarried(world.score, 0);
  world.events?.emit('mouse:caught', { x: atX, y: atY, livesLeft: mouse.lives });
  if (mouse.lives > 0) {
    respawnMouse(mouse);
    return true;
  }
  mouse.transform.vx = 0;
  mouse.transform.vy = 0;
  return true;
}

export function respawnMouse(mouse: MouseRuntime): void {
  mouse.transform.x = mouse.spawnX;
  mouse.transform.y = mouse.spawnY;
  mouse.transform.vx = 0;
  mouse.transform.vy = 0;
  mouse.stance = 'idle';
  mouse.dashTimer = 0;
  mouse.stamina = mouse.stats.staminaMax;
  mouse.invulnerable = CATCH_INVULN;
  applyStatus(mouse.statuses, makeStatus('invulnerable', CATCH_INVULN, 1, 'respawn'));
  mouse.carrying = 0;
}

export function mouseStep(
  mouse: MouseRuntime,
  input: InputSnapshot,
  world: MouseWorld,
  dt: number,
): MouseStepResult {
  tickStatuses(mouse.statuses, dt);
  if (mouse.invulnerable > 0) mouse.invulnerable = Math.max(0, mouse.invulnerable - dt);
  if (mouse.dashCooldown > 0) mouse.dashCooldown = Math.max(0, mouse.dashCooldown - dt);

  if (mouse.stance === 'caught' && mouse.lives <= 0) {
    mouse.transform.vx = 0;
    mouse.transform.vy = 0;
    mouse.lastNoise = 0;
    return { noise: 0, scent: 0, moved: false, interacted: false };
  }

  const axis = axisOf(input);
  const acting = canAct(mouse.statuses) && mouse.stance !== 'caught';

  if (acting && (input.pressed('dash') || (input.down('dash') && mouse.dashTimer <= 0 && mouse.dashCooldown <= 0))) {
    if (tryDash(mouse, axis.x, axis.y)) {
      world.events?.emit('mouse:dash', { x: mouse.transform.x, y: mouse.transform.y });
    }
  }

  if (mouse.dashTimer > 0) {
    mouse.dashTimer = Math.max(0, mouse.dashTimer - dt);
    mouse.stance = 'dash';
    if (mouse.dashTimer <= 0) {
      if (mouse.stamina < mouse.stats.staminaDashCost * 0.5) {
        applyStatus(mouse.statuses, makeStatus('exhausted', 0.85, 1, 'dash'));
      }
    }
  } else if (!acting) {
    mouse.stance = hasStatus(mouse.statuses, 'stunned') ? 'stunned' : mouse.stance === 'caught' ? 'caught' : 'idle';
    mouse.transform.vx = 0;
    mouse.transform.vy = 0;
  } else if (input.down('sneak')) {
    mouse.stance = 'sneak';
  } else if (Math.hypot(axis.x, axis.y) > 0.05) {
    mouse.stance = mouse.carrying > 0 ? 'carry' : 'walk';
  } else {
    mouse.stance = mouse.carrying > 0 ? 'carry' : 'idle';
  }

  if (acting) {
    if (mouse.stance === 'dash') {
      // keep locked dash vector
    } else {
      const sneak = mouse.stance === 'sneak';
      const base = sneak ? mouse.stats.sneakSpeed : mouse.stats.walkSpeed;
      const carry = mouse.carryCapacity > 0 ? mouse.carrying / mouse.carryCapacity : 0;
      const scaled = base * (1 - mouse.stats.carryPenalty * carry) * speedMultiplier(mouse.statuses);
      mouse.transform.vx = axis.x * scaled;
      mouse.transform.vy = axis.y * scaled;
    }
  }

  const tile = propsAtWorld(world.tiles, mouse.transform.x, mouse.transform.y);
  if (tile.kind === 'water' && mouse.stance !== 'dash') {
    mouse.transform.vx *= 0.62;
    mouse.transform.vy *= 0.62;
  }

  const moved = moveCircle(
    mouse.transform.x,
    mouse.transform.y,
    mouse.transform.vx,
    mouse.transform.vy,
    mouse.transform.radius,
    dt,
    world.tiles,
    true,
  );
  mouse.transform.x = moved.x;
  mouse.transform.y = moved.y;
  if (Math.hypot(mouse.transform.vx, mouse.transform.vy) > 0.04) {
    mouse.transform.facing = wrapAngle(Math.atan2(mouse.transform.vy, mouse.transform.vx));
  }

  if (mouse.stance !== 'dash') {
    mouse.stamina = clamp(mouse.stamina + mouse.stats.staminaRegen * dt, 0, mouse.stats.staminaMax);
  }

  pickupLoose(mouse, world);
  tryPickupPowerUp(mouse, world.powerUps, world.events, PICKUP_RADIUS, world.cats);
  tickMagnet(mouse, world.cheeses, dt, world.events, world.cats);
  setCarried(world.score, mouse.carrying);

  let interacted = false;
  if (acting && input.pressed('interact')) {
    interacted = interact(mouse, world);
  }
  if (acting && input.pressed('decoy')) {
    dropDecoy(mouse, world.decoys, world.allocateEntity, world.events);
    interacted = true;
  }
  let extraNoise = 0;
  if (acting && input.pressed('usePowerUp')) {
    const used = usePowerUp(mouse, world.cats, world.events);
    extraNoise = used.noise;
    if (used.decoy) dropDecoy(mouse, world.decoys, world.allocateEntity, world.events, 3.4, 7);
  }

  const moving = Math.hypot(mouse.transform.vx, mouse.transform.vy) > 0.05;
  let noise = extraNoise;
  if (moving) {
    if (mouse.stance === 'dash') noise += mouse.stats.noiseDash;
    else if (mouse.stance === 'sneak') noise += mouse.stats.noiseSneak;
    else noise += mouse.stats.noiseWalk;
  }
  noise *= tile.noise;
  noise *= noiseMultiplier(mouse.statuses);
  mouse.lastNoise = noise;
  if (noise >= NOISE_EMIT_THRESHOLD) {
    world.events?.emit('mouse:noise', { x: mouse.transform.x, y: mouse.transform.y, loudness: noise });
  }

  let scent = 0;
  if (moving) {
    scent = mouse.stance === 'sneak' ? mouse.stats.scentSneak : mouse.stats.scentWalk;
    if (mouse.stance === 'dash') scent = mouse.stats.scentWalk * 1.6;
  } else {
    scent = SCENT_IDLE;
  }
  scent *= scentMultiplier(mouse.statuses);

  return { noise, scent, moved: moving, interacted };
}

export function overlappingCat(mouse: MouseRuntime, cat: CatRuntime): boolean {
  const reach = mouse.transform.radius + cat.transform.radius;
  return distance(mouse.transform.x, mouse.transform.y, cat.transform.x, cat.transform.y) <= reach;
}

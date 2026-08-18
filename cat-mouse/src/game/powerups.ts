import type { EventBusLike } from '../engine/types';
import type { CatRuntime, MouseRuntime, PowerUpKind, PowerUpRuntime } from './types';
import { POWER_UP_PROFILES } from './defaults';
import { applyStatus, makeStatus } from './status';

export function createPowerUp(entity: number, kind: PowerUpKind, x: number, y: number, respawn = 0): PowerUpRuntime {
  return { entity, kind, x, y, taken: false, respawn, respawnIn: 0 };
}

export function nearestPowerUp(
  powerUps: readonly PowerUpRuntime[],
  x: number,
  y: number,
  radius: number,
): PowerUpRuntime | null {
  let best: PowerUpRuntime | null = null;
  let bestD = radius * radius;
  for (let i = 0; i < powerUps.length; i += 1) {
    const item = powerUps[i]!;
    if (item.taken) continue;
    const dx = item.x - x;
    const dy = item.y - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = item;
    }
  }
  return best;
}

export function tryPickupPowerUp(
  mouse: MouseRuntime,
  powerUps: PowerUpRuntime[],
  events?: EventBusLike,
  radius = 0.55,
  cats: CatRuntime[] = [],
): PowerUpRuntime | null {
  const item = nearestPowerUp(powerUps, mouse.transform.x, mouse.transform.y, radius);
  if (!item) return null;
  item.taken = true;
  item.respawnIn = item.respawn;
  events?.emit('powerUp:taken', { kind: item.kind });
  const profile = POWER_UP_PROFILES[item.kind];
  if (mouse.heldPowerUp && mouse.heldPowerUp !== item.kind) {
    usePowerUp(mouse, cats, events);
  }
  mouse.heldPowerUp = item.kind;
  if (profile.autoUse) usePowerUp(mouse, cats, events);
  return item;
}

export function tickPowerUps(powerUps: PowerUpRuntime[], dt: number): void {
  for (let i = 0; i < powerUps.length; i += 1) {
    const item = powerUps[i]!;
    if (!item.taken || item.respawn <= 0) continue;
    item.respawnIn -= dt;
    if (item.respawnIn <= 0) {
      item.taken = false;
      item.respawnIn = 0;
    }
  }
}

export interface PowerUseResult {
  kind: PowerUpKind | null;
  used: boolean;
  noise: number;
  decoy: boolean;
}

export function usePowerUp(
  mouse: MouseRuntime,
  cats: CatRuntime[],
  events?: EventBusLike,
): PowerUseResult {
  const kind = mouse.heldPowerUp;
  if (!kind) return { kind: null, used: false, noise: 0, decoy: false };
  mouse.heldPowerUp = null;
  const profile = POWER_UP_PROFILES[kind];
  events?.emit('powerUp:used', { kind });
  switch (kind) {
    case 'speed':
      applyStatus(mouse.statuses, makeStatus('hasted', profile.duration, profile.magnitude, kind));
      return { kind, used: true, noise: 0, decoy: false };
    case 'invisibility':
      applyStatus(mouse.statuses, makeStatus('invisible', profile.duration, 1, kind));
      applyStatus(mouse.statuses, makeStatus('scentless', profile.duration * 0.55, 1, kind));
      return { kind, used: true, noise: 0, decoy: false };
    case 'freeze':
      for (let i = 0; i < cats.length; i += 1) {
        const cat = cats[i]!;
        cat.frozen = Math.max(cat.frozen, profile.duration);
        applyStatus(cat.statuses, makeStatus('frozen', profile.duration, 1, kind));
      }
      return { kind, used: true, noise: 0, decoy: false };
    case 'decoy':
      mouse.crumbs += 2;
      return { kind, used: true, noise: 0, decoy: true };
    case 'extraLife':
      mouse.lives += 1;
      return { kind, used: true, noise: 0, decoy: false };
    case 'noiseBomb':
      return { kind, used: true, noise: profile.magnitude, decoy: false };
    case 'magnet':
      applyStatus(mouse.statuses, makeStatus('magnetized', profile.duration, profile.magnitude, kind));
      return { kind, used: true, noise: 0, decoy: false };
    case 'featherFoot':
      applyStatus(mouse.statuses, makeStatus('quiet', profile.duration, profile.magnitude, kind));
      applyStatus(mouse.statuses, makeStatus('scentless', profile.duration * 0.4, 1, kind));
      return { kind, used: true, noise: 0, decoy: false };
    case 'scentMask':
      applyStatus(mouse.statuses, makeStatus('scentless', profile.duration, 1, kind));
      return { kind, used: true, noise: 0, decoy: false };
    case 'timeSlip':
      applyStatus(mouse.statuses, makeStatus('hasted', profile.duration, 0.2, kind));
      for (let i = 0; i < cats.length; i += 1) {
        applyStatus(cats[i]!.statuses, makeStatus('slowed', profile.duration, profile.magnitude, kind));
      }
      return { kind, used: true, noise: 0, decoy: false };
    default:
      return { kind, used: false, noise: 0, decoy: false };
  }
}

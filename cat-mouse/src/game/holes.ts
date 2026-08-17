import { distance } from '../engine/math';
import type { EventBusLike } from '../engine/types';
import type { HoleRuntime, MouseRuntime, ScoreState } from './types';
import { HOLE_RADIUS, INTERACT_RADIUS } from './defaults';
import { bankCheese } from './score';

export function createHole(
  entity: number,
  x: number,
  y: number,
  isExit = true,
  linkedTo = -1,
  radius = HOLE_RADIUS,
): HoleRuntime {
  return { entity, x, y, radius, isExit, linkedTo };
}

export function nearestHole(holes: readonly HoleRuntime[], x: number, y: number, radius: number): HoleRuntime | null {
  let best: HoleRuntime | null = null;
  let bestD = radius;
  for (let i = 0; i < holes.length; i += 1) {
    const hole = holes[i]!;
    const d = distance(hole.x, hole.y, x, y);
    if (d <= bestD) {
      bestD = d;
      best = hole;
    }
  }
  return best;
}

export function holeAt(holes: readonly HoleRuntime[], x: number, y: number): HoleRuntime | null {
  return nearestHole(holes, x, y, INTERACT_RADIUS);
}

export function bindSpawnToHole(mouse: MouseRuntime, hole: HoleRuntime): void {
  mouse.spawnX = hole.x;
  mouse.spawnY = hole.y;
}

export function tryUseHole(
  mouse: MouseRuntime,
  holes: HoleRuntime[],
  score: ScoreState,
  events?: EventBusLike,
): { banked: number; teleported: boolean } {
  const hole = holeAt(holes, mouse.transform.x, mouse.transform.y);
  if (!hole) return { banked: 0, teleported: false };
  bindSpawnToHole(mouse, hole);
  let banked = 0;
  if (hole.isExit && mouse.carrying > 0) {
    const quiet = mouse.stance === 'sneak' || mouse.lastNoise < 0.12;
    banked = bankCheese(score, mouse.carrying, quiet);
    mouse.carrying = 0;
    events?.emit('cheese:banked', { total: score.cheeseBanked, quota: score.quota, combo: score.combo });
  }
  let teleported = false;
  if (hole.linkedTo >= 0 && hole.linkedTo < holes.length && banked === 0) {
    const dest = holes[hole.linkedTo]!;
    if (dest && dest !== hole) {
      mouse.transform.x = dest.x;
      mouse.transform.y = dest.y;
      mouse.transform.vx = 0;
      mouse.transform.vy = 0;
      mouse.invulnerable = Math.max(mouse.invulnerable, 0.35);
      bindSpawnToHole(mouse, dest);
      teleported = true;
    }
  }
  return { banked, teleported };
}

export function exitHoles(holes: readonly HoleRuntime[]): HoleRuntime[] {
  return holes.filter((hole) => hole.isExit);
}

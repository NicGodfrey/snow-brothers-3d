import { distance, vFromAngle } from '../engine/math';
import type { EventBusLike } from '../engine/types';
import type { CatRuntime, HazardKind, HazardRuntime, MouseRuntime } from './types';
import { HAZARD_COOLDOWN, HAZARD_RADIUS } from './defaults';
import { applyStatus, makeStatus } from './status';

export function createHazard(
  entity: number,
  kind: HazardKind,
  x: number,
  y: number,
  facing = 0,
): HazardRuntime {
  return {
    entity,
    kind,
    x,
    y,
    radius: HAZARD_RADIUS[kind] ?? 0.45,
    armed: true,
    cooldown: 0,
    noise: kind === 'snapTrap' ? 2.4 : kind === 'vacuum' ? 0.9 : kind === 'broom' ? 1.1 : 0.4,
    facing,
  };
}

function overlapping(hazard: HazardRuntime, mouse: MouseRuntime): boolean {
  return distance(hazard.x, hazard.y, mouse.transform.x, mouse.transform.y) <= hazard.radius + mouse.transform.radius;
}

export interface HazardTickResult {
  noise: number;
  triggered: HazardKind | null;
}

export function tickHazards(
  hazards: HazardRuntime[],
  mouse: MouseRuntime,
  _cats: CatRuntime[],
  dt: number,
  events?: EventBusLike,
): HazardTickResult {
  let noise = 0;
  let triggered: HazardKind | null = null;
  for (let i = 0; i < hazards.length; i += 1) {
    const hazard = hazards[i]!;
    if (hazard.cooldown > 0) hazard.cooldown = Math.max(0, hazard.cooldown - dt);
    const hit = overlapping(hazard, mouse);
    switch (hazard.kind) {
      case 'snapTrap':
        if (hit && hazard.armed && mouse.invulnerable <= 0) {
          applyStatus(mouse.statuses, makeStatus('stunned', 0.85, 1, 'snapTrap'));
          mouse.stance = 'stunned';
          hazard.armed = false;
          hazard.cooldown = HAZARD_COOLDOWN.snapTrap;
          noise = Math.max(noise, hazard.noise);
          triggered = 'snapTrap';
          events?.emit('hazard:triggered', { kind: 'snapTrap', x: hazard.x, y: hazard.y });
        }
        if (!hazard.armed && hazard.cooldown <= 0) hazard.armed = true;
        break;
      case 'glueBoard':
        if (hit) applyStatus(mouse.statuses, makeStatus('slowed', 0.2, 0.55, 'glueBoard'));
        break;
      case 'water':
        if (hit) {
          applyStatus(mouse.statuses, makeStatus('slowed', 0.15, 0.35, 'water'));
          noise = Math.max(noise, 0.55);
        }
        break;
      case 'fan': {
        if (!hit) break;
        const push = vFromAngle(hazard.facing, 3.4 * dt);
        mouse.transform.x += push.x;
        mouse.transform.y += push.y;
        noise = Math.max(noise, 0.25);
        break;
      }
      case 'broom':
        if (hazard.cooldown <= 0) {
          hazard.cooldown = HAZARD_COOLDOWN.broom;
          if (hit && mouse.invulnerable <= 0) {
            const dx = mouse.transform.x - hazard.x;
            const dy = mouse.transform.y - hazard.y;
            const len = Math.hypot(dx, dy) || 1;
            mouse.transform.x += (dx / len) * 0.85;
            mouse.transform.y += (dy / len) * 0.85;
            applyStatus(mouse.statuses, makeStatus('stunned', 0.35, 1, 'broom'));
            noise = Math.max(noise, hazard.noise);
            triggered = 'broom';
            events?.emit('hazard:triggered', { kind: 'broom', x: hazard.x, y: hazard.y });
          }
        }
        break;
      case 'vacuum':
        if (hit) {
          const dx = hazard.x - mouse.transform.x;
          const dy = hazard.y - mouse.transform.y;
          const len = Math.hypot(dx, dy) || 1;
          const pull = 1.8 * dt;
          mouse.transform.x += (dx / len) * pull;
          mouse.transform.y += (dy / len) * pull;
          if (len < 0.35 && mouse.invulnerable <= 0) {
            applyStatus(mouse.statuses, makeStatus('stunned', 0.4, 1, 'vacuum'));
            noise = Math.max(noise, hazard.noise);
            triggered = 'vacuum';
            events?.emit('hazard:triggered', { kind: 'vacuum', x: hazard.x, y: hazard.y });
          }
        }
        break;
      case 'sparkWire':
        if (hazard.cooldown <= 0) {
          hazard.armed = true;
          if (hit && mouse.invulnerable <= 0) {
            applyStatus(mouse.statuses, makeStatus('stunned', 0.55, 1, 'sparkWire'));
            mouse.stance = 'stunned';
            hazard.cooldown = HAZARD_COOLDOWN.sparkWire;
            hazard.armed = false;
            noise = Math.max(noise, 1.6);
            triggered = 'sparkWire';
            events?.emit('hazard:triggered', { kind: 'sparkWire', x: hazard.x, y: hazard.y });
          } else if (!hit) {
            hazard.cooldown = HAZARD_COOLDOWN.sparkWire;
            hazard.armed = false;
          }
        }
        break;
      default:
        break;
    }
  }
  return { noise, triggered };
}

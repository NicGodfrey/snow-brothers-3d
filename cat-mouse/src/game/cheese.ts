import { distance } from '../engine/math';
import type { EventBusLike } from '../engine/types';
import type { CheeseRuntime, MouseRuntime } from './types';
import { CHEESE_RADIUS, INTERACT_RADIUS } from './defaults';
import { isMagnetized, statusMagnitude } from './status';

export function createCheese(
  entity: number,
  x: number,
  y: number,
  value = 1,
  guarded = false,
): CheeseRuntime {
  return { entity, x, y, value, taken: false, guarded };
}

export function cheeseInRange(cheese: CheeseRuntime, x: number, y: number, radius: number): boolean {
  if (cheese.taken) return false;
  return distance(cheese.x, cheese.y, x, y) <= radius;
}

export function nearestCheese(cheeses: readonly CheeseRuntime[], x: number, y: number, radius: number): CheeseRuntime | null {
  let best: CheeseRuntime | null = null;
  let bestD = radius;
  for (let i = 0; i < cheeses.length; i += 1) {
    const cheese = cheeses[i]!;
    if (cheese.taken) continue;
    const d = distance(cheese.x, cheese.y, x, y);
    if (d <= bestD) {
      bestD = d;
      best = cheese;
    }
  }
  return best;
}

export function guardBlocksPickup(
  cheese: CheeseRuntime,
  cats: readonly { transform: { x: number; y: number } }[],
  range = 3.4,
): boolean {
  if (!cheese.guarded) return false;
  for (let i = 0; i < cats.length; i += 1) {
    const cat = cats[i]!;
    if (distance(cheese.x, cheese.y, cat.transform.x, cat.transform.y) <= range) return true;
  }
  return false;
}

export function tryPickupCheese(
  mouse: MouseRuntime,
  cheeses: CheeseRuntime[],
  events: EventBusLike | undefined,
  cats: readonly { transform: { x: number; y: number } }[] = [],
  radius = INTERACT_RADIUS,
): CheeseRuntime | null {
  if (mouse.carrying >= mouse.carryCapacity) return null;
  const cheese = nearestCheese(cheeses, mouse.transform.x, mouse.transform.y, radius);
  if (!cheese) return null;
  if (guardBlocksPickup(cheese, cats)) return null;
  cheese.taken = true;
  mouse.carrying += cheese.value;
  events?.emit('cheese:taken', { x: cheese.x, y: cheese.y, value: cheese.value });
  return cheese;
}

export function dropCarriedCheese(
  mouse: MouseRuntime,
  cheeses: CheeseRuntime[],
  allocateEntity: () => number,
): CheeseRuntime | null {
  if (mouse.carrying <= 0) return null;
  const dropped = createCheese(allocateEntity(), mouse.transform.x, mouse.transform.y, mouse.carrying, false);
  cheeses.push(dropped);
  mouse.carrying = 0;
  return dropped;
}

export function tickMagnet(
  mouse: MouseRuntime,
  cheeses: CheeseRuntime[],
  dt: number,
  events?: EventBusLike,
  cats: readonly { transform: { x: number; y: number } }[] = [],
): number {
  if (!isMagnetized(mouse.statuses) || mouse.carrying >= mouse.carryCapacity) return 0;
  const range = Math.max(CHEESE_RADIUS, statusMagnitude(mouse.statuses, 'magnetized') || 2.4);
  let pulled = 0;
  for (let i = 0; i < cheeses.length; i += 1) {
    const cheese = cheeses[i]!;
    if (cheese.taken) continue;
    const d = distance(cheese.x, cheese.y, mouse.transform.x, mouse.transform.y);
    if (d > range) continue;
    const pull = 3.2 * dt;
    if (d <= INTERACT_RADIUS * 0.85) {
      if (guardBlocksPickup(cheese, cats)) continue;
      if (mouse.carrying >= mouse.carryCapacity) break;
      cheese.taken = true;
      mouse.carrying += cheese.value;
      events?.emit('cheese:taken', { x: cheese.x, y: cheese.y, value: cheese.value });
      pulled += 1;
      continue;
    }
    const ux = (mouse.transform.x - cheese.x) / Math.max(d, 1e-6);
    const uy = (mouse.transform.y - cheese.y) / Math.max(d, 1e-6);
    cheese.x += ux * pull;
    cheese.y += uy * pull;
  }
  return pulled;
}

export function remainingCheeseValue(cheeses: readonly CheeseRuntime[]): number {
  let total = 0;
  for (let i = 0; i < cheeses.length; i += 1) {
    if (!cheeses[i]!.taken) total += cheeses[i]!.value;
  }
  return total;
}

export function allCheeseTaken(cheeses: readonly CheeseRuntime[]): boolean {
  if (cheeses.length === 0) return false;
  for (let i = 0; i < cheeses.length; i += 1) {
    if (!cheeses[i]!.taken) return false;
  }
  return true;
}

import type { StatusEffect, StatusEffectKind } from './types';

const EXCLUSIVE: ReadonlySet<StatusEffectKind> = new Set(['hasted', 'slowed']);

export function makeStatus(
  kind: StatusEffectKind,
  remaining: number,
  magnitude = 1,
  source = 'world',
): StatusEffect {
  return { kind, remaining, magnitude, source };
}

export function hasStatus(list: readonly StatusEffect[], kind: StatusEffectKind): boolean {
  for (let i = 0; i < list.length; i += 1) {
    if (list[i]!.kind === kind && list[i]!.remaining > 0) return true;
  }
  return false;
}

export function statusMagnitude(list: readonly StatusEffect[], kind: StatusEffectKind): number {
  let best = 0;
  for (let i = 0; i < list.length; i += 1) {
    const effect = list[i]!;
    if (effect.kind === kind && effect.remaining > 0 && effect.magnitude > best) best = effect.magnitude;
  }
  return best;
}

export function statusRemaining(list: readonly StatusEffect[], kind: StatusEffectKind): number {
  let best = 0;
  for (let i = 0; i < list.length; i += 1) {
    const effect = list[i]!;
    if (effect.kind === kind && effect.remaining > best) best = effect.remaining;
  }
  return best;
}

export function removeStatus(list: StatusEffect[], kind: StatusEffectKind, source?: string): void {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const effect = list[i]!;
    if (effect.kind !== kind) continue;
    if (source !== undefined && effect.source !== source) continue;
    list.splice(i, 1);
  }
}

export function applyStatus(list: StatusEffect[], effect: StatusEffect): StatusEffect {
  if (effect.remaining <= 0) return effect;
  if (EXCLUSIVE.has(effect.kind)) {
    if (effect.kind === 'hasted') removeStatus(list, 'slowed');
    if (effect.kind === 'slowed') removeStatus(list, 'hasted');
  }
  for (let i = 0; i < list.length; i += 1) {
    const existing = list[i]!;
    if (existing.kind !== effect.kind || existing.source !== effect.source) continue;
    existing.remaining = Math.max(existing.remaining, effect.remaining);
    existing.magnitude = Math.max(existing.magnitude, effect.magnitude);
    return existing;
  }
  list.push(effect);
  return effect;
}

export function tickStatuses(list: StatusEffect[], dt: number): StatusEffect[] {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const effect = list[i]!;
    effect.remaining -= dt;
    if (effect.remaining <= 0) list.splice(i, 1);
  }
  return list;
}

export function speedMultiplier(list: readonly StatusEffect[]): number {
  let mul = 1;
  if (hasStatus(list, 'hasted')) mul *= 1 + statusMagnitude(list, 'hasted');
  if (hasStatus(list, 'slowed')) mul *= Math.max(0.15, 1 - statusMagnitude(list, 'slowed'));
  if (hasStatus(list, 'exhausted')) mul *= 0.62;
  if (hasStatus(list, 'enraged')) mul *= 1.18;
  if (hasStatus(list, 'frozen') || hasStatus(list, 'stunned')) mul = 0;
  return mul;
}

export function canAct(list: readonly StatusEffect[]): boolean {
  return !hasStatus(list, 'frozen') && !hasStatus(list, 'stunned');
}

export function canSee(list: readonly StatusEffect[]): boolean {
  return !hasStatus(list, 'blinded') && !hasStatus(list, 'frozen');
}

export function canHear(list: readonly StatusEffect[]): boolean {
  return !hasStatus(list, 'deafened');
}

export function isInvisible(list: readonly StatusEffect[]): boolean {
  return hasStatus(list, 'invisible');
}

export function isScentless(list: readonly StatusEffect[]): boolean {
  return hasStatus(list, 'scentless');
}

export function isInvulnerable(list: readonly StatusEffect[]): boolean {
  return hasStatus(list, 'invulnerable');
}

export function isMagnetized(list: readonly StatusEffect[]): boolean {
  return hasStatus(list, 'magnetized');
}

export function noiseMultiplier(list: readonly StatusEffect[]): number {
  let mul = 1;
  if (hasStatus(list, 'quiet')) mul *= Math.max(0.08, statusMagnitude(list, 'quiet') || 0.3);
  if (hasStatus(list, 'invisible')) mul *= 0.55;
  if (hasStatus(list, 'exhausted')) mul *= 1.15;
  return mul;
}

export function scentMultiplier(list: readonly StatusEffect[]): number {
  if (isScentless(list)) return 0;
  if (isInvisible(list)) return 0.35;
  if (hasStatus(list, 'quiet')) return 0.45;
  return 1;
}

export function hearingMultiplier(list: readonly StatusEffect[]): number {
  if (!canHear(list)) return 0;
  if (hasStatus(list, 'enraged')) return 1.15;
  return 1;
}

export function copyStatuses(list: readonly StatusEffect[]): StatusEffect[] {
  return list.map((effect) => ({ ...effect }));
}

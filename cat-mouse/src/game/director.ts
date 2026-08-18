import { approach, clamp, clamp01 } from '../engine/math';
import type { CatRuntime, DirectorState, ScoreState } from './types';
import { applyStatus, makeStatus } from './status';

export function createDirector(waveIndex = 0): DirectorState {
  return {
    intensity: 0.22,
    targetIntensity: 0.22,
    restTimer: 0,
    waveIndex,
    spawnBudget: 0,
    lastEvent: 'boot',
    escalation: 0,
  };
}

export function tickDirector(
  director: DirectorState,
  score: ScoreState,
  catCount: number,
  dt: number,
  spotted: boolean,
): void {
  const remaining = clamp01(1 - score.cheeseBanked / Math.max(1, score.quota));
  const timePressure = clamp01(score.timeSeconds / 180);
  let target = score.heat * 0.52 + remaining * 0.28 + timePressure * 0.18;
  if (spotted) target += 0.12;
  if (catCount === 0) target *= 0.4;
  target = clamp01(target);

  if (target < 0.28) director.restTimer += dt;
  else director.restTimer = Math.max(0, director.restTimer - dt * 0.6);

  if (director.restTimer > 5) target *= 0.55;

  director.targetIntensity = target;
  director.intensity = approach(director.intensity, director.targetIntensity, dt * 0.32);

  if (director.intensity > 0.78) {
    const next = director.escalation + dt * 0.15;
    if (Math.floor(next) > Math.floor(director.escalation)) director.lastEvent = 'escalate';
    director.escalation = next;
  } else if (director.intensity < 0.35) {
    director.escalation = Math.max(0, director.escalation - dt * 0.05);
  }

  if (director.intensity > 0.85) director.spawnBudget = 1;
  else director.spawnBudget = 0;
}

export function aggressionMultiplier(director: DirectorState): number {
  return 1 + director.intensity * 0.42 + Math.min(3, director.escalation) * 0.07;
}

export function napSuppress(director: DirectorState): number {
  return clamp(1 - director.intensity * 1.1, 0.05, 1);
}

export function applyDirectorToCats(director: DirectorState, cats: CatRuntime[], dt: number): void {
  if (director.intensity < 0.72) return;
  for (let i = 0; i < cats.length; i += 1) {
    const cat = cats[i]!;
    if (cat.frozen > 0) continue;
    if (director.intensity > 0.82) {
      applyStatus(cat.statuses, makeStatus('enraged', 0.6, 1, 'director'));
    }
    cat.suspicion = clamp01(cat.suspicion + dt * 0.05 * director.intensity);
  }
}

export function noteDirectorEvent(director: DirectorState, event: string): void {
  director.lastEvent = event;
}

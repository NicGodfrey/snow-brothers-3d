import { clamp, clamp01 } from '../engine/math';
import type { ScoreState, StageResult } from './types';
import { COMBO_WINDOW } from './defaults';

export function createScoreState(quota: number): ScoreState {
  return {
    cheeseBanked: 0,
    cheeseCarried: 0,
    quota: Math.max(1, quota),
    score: 0,
    combo: 0,
    comboTimer: 0,
    bestCombo: 0,
    heat: 0,
    stealthBonus: 0,
    timeSeconds: 0,
    catches: 0,
    stars: 0,
  };
}

export function quotaMet(score: ScoreState): boolean {
  return score.cheeseBanked >= score.quota;
}

export function quotaProgress(score: ScoreState): number {
  return clamp01(score.cheeseBanked / Math.max(1, score.quota));
}

export function tickScore(score: ScoreState, dt: number): void {
  score.timeSeconds += dt;
  if (score.comboTimer > 0) {
    score.comboTimer = Math.max(0, score.comboTimer - dt);
    if (score.comboTimer === 0) score.combo = 0;
  }
  decayHeat(score, dt);
}

export function decayHeat(score: ScoreState, dt: number): void {
  const rate = 0.07 + (1 - score.heat) * 0.03;
  score.heat = Math.max(0, score.heat - rate * dt);
}

export function addHeat(score: ScoreState, amount: number): void {
  score.heat = clamp01(score.heat + amount);
}

export function registerCatch(score: ScoreState): void {
  score.catches += 1;
  score.combo = 0;
  score.comboTimer = 0;
  addHeat(score, 0.28);
}

export function setCarried(score: ScoreState, carrying: number): void {
  score.cheeseCarried = Math.max(0, carrying);
}

export function pickupScore(score: ScoreState, value: number): void {
  score.cheeseCarried += value;
}

export function bankCheese(score: ScoreState, value: number, quiet: boolean): number {
  const amount = Math.max(0, value);
  if (amount <= 0) return 0;
  if (score.comboTimer > 0) score.combo += 1;
  else score.combo = 1;
  score.comboTimer = COMBO_WINDOW;
  if (score.combo > score.bestCombo) score.bestCombo = score.combo;
  score.cheeseBanked += amount;
  score.cheeseCarried = Math.max(0, score.cheeseCarried - amount);
  const comboMul = 1 + (score.combo - 1) * 0.28;
  let stealth = 0;
  if (quiet) {
    stealth = Math.round(40 * amount * (1 - score.heat));
    score.stealthBonus += stealth;
    addHeat(score, -0.06 * amount);
  } else {
    addHeat(score, 0.04 * amount);
  }
  const gained = Math.round(100 * amount * comboMul) + stealth;
  score.score += gained;
  return gained;
}

export function addPoints(score: ScoreState, points: number): void {
  score.score += Math.max(0, Math.round(points));
}

export function evaluateStars(score: ScoreState, parTime: number): number {
  if (score.cheeseBanked < score.quota) return 0;
  let stars = 1;
  if (parTime <= 0 || score.timeSeconds <= parTime) stars += 1;
  if (score.catches === 0) stars += 1;
  score.stars = stars;
  return stars;
}

export function stageResultOf(
  outcome: StageResult['outcome'],
  stageId: string,
  score: ScoreState,
  parTime: number,
): StageResult {
  evaluateStars(score, parTime);
  return {
    outcome,
    stageId,
    score: score.score,
    timeSeconds: score.timeSeconds,
    cheeseBanked: score.cheeseBanked,
    quota: score.quota,
    catches: score.catches,
    stars: score.stars,
    noCatch: score.catches === 0,
  };
}

export function heatFromNoise(loudness: number): number {
  return clamp(loudness * 0.035, 0, 0.2);
}

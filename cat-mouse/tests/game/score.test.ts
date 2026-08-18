import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addHeat,
  bankCheese,
  createScoreState,
  evaluateStars,
  quotaMet,
  registerCatch,
  tickScore,
} from '../../src/game/score';

describe('score', () => {
  it('banks cheese toward the quota', () => {
    const score = createScoreState(3);
    score.cheeseCarried = 2;
    const gained = bankCheese(score, 2, false);
    assert.ok(gained > 0);
    assert.equal(score.cheeseBanked, 2);
    assert.equal(score.cheeseCarried, 0);
    assert.equal(quotaMet(score), false);
    score.cheeseCarried = 1;
    bankCheese(score, 1, false);
    assert.equal(quotaMet(score), true);
  });

  it('builds a combo when banking inside the window', () => {
    const score = createScoreState(5);
    bankCheese(score, 1, false);
    assert.equal(score.combo, 1);
    bankCheese(score, 1, false);
    assert.equal(score.combo, 2);
    assert.equal(score.bestCombo, 2);
    const withCombo = score.score;
    const other = createScoreState(5);
    bankCheese(other, 1, false);
    tickScore(other, 5);
    assert.equal(other.combo, 0);
    bankCheese(other, 1, false);
    assert.ok(withCombo > other.score);
  });

  it('awards stars for quota, par time, and a no-catch run', () => {
    const score = createScoreState(1);
    bankCheese(score, 1, true);
    score.timeSeconds = 10;
    score.catches = 0;
    assert.equal(evaluateStars(score, 30), 3);
    score.catches = 1;
    assert.equal(evaluateStars(score, 30), 2);
    score.timeSeconds = 90;
    assert.equal(evaluateStars(score, 30), 1);
    const short = createScoreState(2);
    assert.equal(evaluateStars(short, 30), 0);
  });

  it('raises heat on a catch and decays it over time', () => {
    const score = createScoreState(1);
    registerCatch(score);
    assert.equal(score.catches, 1);
    assert.ok(score.heat > 0.2);
    const before = score.heat;
    tickScore(score, 2);
    assert.ok(score.heat < before);
  });

  it('adds stealth bonus when banking quietly', () => {
    const loud = createScoreState(2);
    addHeat(loud, 0.9);
    loud.cheeseCarried = 1;
    bankCheese(loud, 1, false);
    const quiet = createScoreState(2);
    quiet.cheeseCarried = 1;
    bankCheese(quiet, 1, true);
    assert.ok(quiet.stealthBonus > loud.stealthBonus);
    assert.ok(quiet.score >= loud.score);
  });
});

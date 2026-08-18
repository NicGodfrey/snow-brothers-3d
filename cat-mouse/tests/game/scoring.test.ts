import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bankCheese,
  createScoreState,
  evaluateStars,
  quotaMet,
  quotaProgress,
  registerCatch,
  stageResultOf,
  tickScore,
} from '../../src/game/score';

test('createScoreState clamps quota to at least 1', () => {
  const score = createScoreState(0);
  assert.equal(score.quota, 1);
  assert.equal(score.cheeseBanked, 0);
  assert.equal(score.catches, 0);
});

test('banking cheese meets quota and awards combo', () => {
  const score = createScoreState(2);
  const first = bankCheese(score, 1, true);
  assert.ok(first > 0);
  assert.equal(score.cheeseBanked, 1);
  assert.equal(quotaMet(score), false);
  bankCheese(score, 1, true);
  assert.equal(quotaMet(score), true);
  assert.equal(score.combo, 2);
  assert.ok(quotaProgress(score) >= 1);
});

test('stars require quota; no-catch and par time add extras', () => {
  const score = createScoreState(1);
  assert.equal(evaluateStars(score, 30), 0);
  bankCheese(score, 1, false);
  score.timeSeconds = 10;
  score.catches = 0;
  assert.equal(evaluateStars(score, 30), 3);
  registerCatch(score);
  assert.equal(evaluateStars(score, 30), 2);
});

test('tickScore advances time and registerCatch breaks combo', () => {
  const score = createScoreState(3);
  bankCheese(score, 1, false);
  assert.equal(score.combo, 1);
  registerCatch(score);
  assert.equal(score.catches, 1);
  assert.equal(score.combo, 0);
  tickScore(score, 0.5);
  assert.ok(score.timeSeconds >= 0.5);
  const result = stageResultOf('won', 'story-1-1', score, 99);
  assert.equal(result.stageId, 'story-1-1');
  assert.equal(result.catches, 1);
  assert.equal(result.noCatch, false);
});

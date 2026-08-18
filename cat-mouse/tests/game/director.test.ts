import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aggressionMultiplier, createDirector, tickDirector } from '../../src/game/director';
import { createScoreState } from '../../src/game/score';

test('director intensity rises with heat, remaining quota and being spotted', () => {
  const director = createDirector();
  const score = createScoreState(4);
  score.heat = 0.9;
  tickDirector(director, score, 1, 1, true);
  assert.ok(director.targetIntensity > 0.22);
  assert.ok(aggressionMultiplier(director) >= 1);
  const calm = createDirector();
  const easy = createScoreState(1);
  easy.cheeseBanked = 1;
  tickDirector(calm, easy, 0, 0.5, false);
  assert.ok(calm.targetIntensity < director.targetIntensity);
});

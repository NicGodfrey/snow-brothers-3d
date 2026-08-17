import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bindSpawnToHole, createHole, exitHoles, tryUseHole } from '../../src/game/holes';
import { createScoreState, quotaMet } from '../../src/game/score';
import { createCheese, tryPickupCheese } from '../../src/game/cheese';
import { makeTestMouse } from '../helpers/actors';

test('depositing cheese in an exit hole banks toward quota', () => {
  const mouse = makeTestMouse(3, 3);
  const cheeses = [createCheese(2, 3, 3, 2)];
  tryPickupCheese(mouse, cheeses, undefined);
  assert.equal(mouse.carrying, 2);
  const holes = [createHole(3, 3, 3, true)];
  const score = createScoreState(2);
  const result = tryUseHole(mouse, holes, score);
  assert.equal(result.banked > 0, true);
  assert.equal(mouse.carrying, 0);
  assert.equal(quotaMet(score), true);
  assert.equal(mouse.spawnX, 3);
});

test('linked holes teleport when not banking', () => {
  const mouse = makeTestMouse(1, 1);
  const a = createHole(1, 1, 1, false, 1);
  const b = createHole(2, 8, 8, false, 0);
  const result = tryUseHole(mouse, [a, b], createScoreState(1));
  assert.equal(result.teleported, true);
  assert.equal(mouse.transform.x, 8);
  assert.deepEqual(exitHoles([a, b]), []);
  bindSpawnToHole(mouse, b);
  assert.equal(mouse.spawnX, 8);
});

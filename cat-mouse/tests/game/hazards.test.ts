import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHazard, tickHazards } from '../../src/game/hazards';
import { hasStatus } from '../../src/game/status';
import { makeTestMouse } from '../helpers/actors';

test('snapTrap stuns the mouse and glue slows', () => {
  const mouse = makeTestMouse(2, 2);
  const trap = createHazard(1, 'snapTrap', 2, 2);
  const result = tickHazards([trap], mouse, [], 0.016);
  assert.equal(result.triggered, 'snapTrap');
  assert.equal(mouse.stance, 'stunned');
  assert.equal(hasStatus(mouse.statuses, 'stunned'), true);
  assert.equal(trap.armed, false);

  const glue = createHazard(2, 'glueBoard', 5, 5);
  const stuck = makeTestMouse(5, 5);
  tickHazards([glue], stuck, [], 0.016);
  assert.equal(hasStatus(stuck.statuses, 'slowed'), true);
});

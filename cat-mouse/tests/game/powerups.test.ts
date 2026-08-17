import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPowerUp, tryPickupPowerUp, usePowerUp } from '../../src/game/powerups';
import { hasStatus } from '../../src/game/status';
import { makeTestCat, makeTestMouse } from '../helpers/actors';

test('speed power-up applies hasted; extraLife auto-applies', () => {
  const mouse = makeTestMouse(1, 1);
  const speed = createPowerUp(2, 'speed', 1, 1);
  assert.ok(tryPickupPowerUp(mouse, [speed]));
  const used = usePowerUp(mouse, []);
  assert.equal(used.used, true);
  assert.equal(hasStatus(mouse.statuses, 'hasted'), true);

  const life = createPowerUp(3, 'extraLife', 1, 1);
  const before = mouse.lives;
  tryPickupPowerUp(mouse, [life]);
  assert.equal(mouse.lives, before + 1);
  assert.equal(mouse.heldPowerUp, null);
});

test('freeze holds cats', () => {
  const mouse = makeTestMouse(1, 1);
  mouse.heldPowerUp = 'freeze';
  const cat = makeTestCat(4, 1);
  const result = usePowerUp(mouse, [cat]);
  assert.equal(result.used, true);
  assert.ok(cat.frozen > 0);
  assert.equal(hasStatus(cat.statuses, 'frozen'), true);
});

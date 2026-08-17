import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyForce, seek, flee } from '../../src/engine/steering';

test('seek pulls toward the target and flee pushes away', () => {
  const body = { x: 0, y: 0, vx: 0, vy: 0 };
  const seekForce = seek(body, { x: 10, y: 0 }, 4, 20);
  assert.ok(seekForce.x > 0);
  const fleeForce = flee(body, { x: 10, y: 0 }, 4, 20);
  assert.ok(fleeForce.x < 0);
  applyForce(body, seekForce, 4, 0.1);
  assert.ok(body.x > 0);
});

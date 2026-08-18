import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameInput, emptyInput, inputFromAxis } from '../../src/game/input';

test('FrameInput tracks hold, press and release across frames', () => {
  const input = new FrameInput();
  input.hold('dash');
  assert.equal(input.down('dash'), true);
  assert.equal(input.pressed('dash'), true);
  input.endFrame();
  assert.equal(input.pressed('dash'), false);
  input.release('dash');
  assert.equal(input.released('dash'), true);
  input.clear();
  assert.equal(input.down('dash'), false);
});

test('emptyInput and inputFromAxis', () => {
  const empty = emptyInput();
  assert.equal(empty.down('up'), false);
  const axis = inputFromAxis(0, 1, { sneak: 'pressed' });
  assert.ok(axis.axisY > 0);
  assert.equal(axis.pressed('sneak'), true);
});

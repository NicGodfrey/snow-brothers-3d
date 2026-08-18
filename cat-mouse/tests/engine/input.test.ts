import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_BINDINGS,
  FrozenInput,
  InputManager,
  actionBit,
  bitsDown,
  encodeInput,
} from '../../src/engine/input';

test('SPEC bindings: WASD/arrows, Shift sneak, Space dash, E Q F Esc M', () => {
  assert.ok(DEFAULT_BINDINGS.up.includes('KeyW'));
  assert.ok(DEFAULT_BINDINGS.up.includes('ArrowUp'));
  assert.ok(DEFAULT_BINDINGS.sneak.includes('ShiftLeft'));
  assert.ok(DEFAULT_BINDINGS.dash.includes('Space'));
  assert.ok(DEFAULT_BINDINGS.interact.includes('KeyE'));
  assert.ok(DEFAULT_BINDINGS.decoy.includes('KeyQ'));
  assert.ok(DEFAULT_BINDINGS.usePowerUp.includes('KeyF'));
  assert.ok(DEFAULT_BINDINGS.pause.includes('Escape'));
  assert.ok(DEFAULT_BINDINGS.mute.includes('KeyM'));
});

test('InputManager feedKey and edge detection', () => {
  const input = new InputManager();
  input.feedKey('KeyD', true);
  assert.equal(input.down('right'), true);
  assert.equal(input.pressed('right'), true);
  assert.equal(input.axisX, 1);
  input.beginFrame();
  assert.equal(input.pressed('right'), false);
  input.feedKey('KeyD', false);
  assert.equal(input.released('right'), true);
  const bits = encodeInput(input.snapshot());
  assert.equal(bitsDown(bits, 'right'), false);
  assert.ok(actionBit('dash') > 0);
});

test('FrozenInput reconstructs axes from bits', () => {
  const held = actionBit('left') | actionBit('sneak');
  const frozen = new FrozenInput(held, 0);
  assert.equal(frozen.down('left'), true);
  assert.equal(frozen.down('sneak'), true);
  assert.equal(frozen.axisX, -1);
  assert.equal(frozen.pressed('left'), true);
});

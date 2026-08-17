import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { StatusEffect } from '../../src/game/types';
import {
  applyStatus,
  canAct,
  copyStatuses,
  hasStatus,
  isInvisible,
  makeStatus,
  speedMultiplier,
  tickStatuses,
} from '../../src/game/status';

test('hasted and slowed are exclusive; freeze stops acting', () => {
  const list: StatusEffect[] = [];
  applyStatus(list, makeStatus('hasted', 2, 0.4, 'speed'));
  applyStatus(list, makeStatus('slowed', 2, 0.5, 'glue'));
  assert.equal(hasStatus(list, 'hasted'), false);
  assert.equal(hasStatus(list, 'slowed'), true);
  applyStatus(list, makeStatus('frozen', 1, 1, 'freeze'));
  assert.equal(canAct(list), false);
  assert.equal(speedMultiplier(list), 0);
});

test('tickStatuses expires effects and copy is detached', () => {
  const list = [makeStatus('invisible', 0.2, 1, 'cloak')];
  assert.equal(isInvisible(list), true);
  tickStatuses(list, 0.25);
  assert.equal(isInvisible(list), false);
  const src = [makeStatus('scentless', 3, 1, 'mask')];
  const copy = copyStatuses(src);
  copy[0]!.remaining = 0;
  assert.equal(src[0]!.remaining, 3);
});

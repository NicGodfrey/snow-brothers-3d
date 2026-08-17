import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrozenInput, actionBit } from '../../src/engine/input';
import { ReplayPlayer, ReplayRecorder, parseReplay, serializeReplay } from '../../src/engine/replay';

test('recorder omits duplicate bits and player holds last mask', () => {
  const rec = new ReplayRecorder(7, 'story-1-1');
  const dash = new FrozenInput(actionBit('dash'));
  rec.record(0, dash);
  rec.record(1, dash);
  rec.record(2, 0);
  assert.equal(rec.length, 2);
  const log = rec.finish();
  const player = new ReplayPlayer(log);
  assert.equal(player.bitsAt(0) & actionBit('dash'), actionBit('dash'));
  assert.equal(player.bitsAt(1) & actionBit('dash'), actionBit('dash'));
  assert.equal(player.bitsAt(2), 0);
  const round = parseReplay(serializeReplay(log));
  assert.ok(round);
  assert.equal(round.seed, 7);
  assert.equal(round.stageId, 'story-1-1');
});

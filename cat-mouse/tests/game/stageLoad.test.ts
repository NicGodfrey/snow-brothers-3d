import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadStage } from '../../src/game/stageLoad';
import stage1 from '../../src/content/stages/story/ch01-s01-crumb-trail';

test('loadStage hydrates Stage 1 with mouse, cat, hole and quota', () => {
  const loaded = loadStage(stage1);
  assert.ok(loaded.score.quota > 0);
  assert.ok(loaded.cats.length >= 1);
  assert.ok(loaded.holes.length >= 1);
  assert.equal(loaded.tiles.width, stage1.width);
  assert.equal(loaded.tiles.height, stage1.height);
  assert.ok(loaded.mouse.lives > 0);
});

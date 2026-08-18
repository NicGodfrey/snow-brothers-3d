import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MemoryStorage,
  emptySave,
  isChapterUnlocked,
  makeSaveStore,
  parseSave,
  serializeSave,
  touchStage,
  unlockAchievement,
  unlockChapter,
} from '../../src/engine/save';

test('save round-trip and chapter unlock', () => {
  const slot = emptySave('squeak');
  assert.equal(slot.unlockedChapters, 1);
  assert.equal(isChapterUnlocked(slot, 1), true);
  assert.equal(isChapterUnlocked(slot, 2), false);
  unlockChapter(slot, 2);
  assert.equal(isChapterUnlocked(slot, 2), true);
  assert.equal(unlockAchievement(slot, 'first-cheese'), true);
  assert.equal(unlockAchievement(slot, 'first-cheese'), false);
  const rec = touchStage(slot, { stageId: 'story-1-1', cleared: true, bestScore: 10, stars: 2, attempts: 1 });
  assert.equal(rec.cleared, true);
  const parsed = parseSave(serializeSave(slot));
  assert.ok(parsed);
  assert.equal(parsed.profile, 'squeak');
  assert.equal(parsed.achievements.includes('first-cheese'), true);
});

test('SaveStore persists in memory', () => {
  const store = makeSaveStore(new MemoryStorage());
  const slot = emptySave('pounce');
  store.write(slot);
  const loaded = store.load('pounce');
  assert.ok(loaded);
  assert.equal(loaded.profile, 'pounce');
  assert.deepEqual(store.list(), ['pounce']);
});

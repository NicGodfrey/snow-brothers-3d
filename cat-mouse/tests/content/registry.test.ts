import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORY_STAGES,
  findStage,
  lastAuthoredChapter,
  stageById,
  stagesOfChapter,
} from '../../src/content/index';

test('content registry lists Stage 1 and looks it up by chapter/index', () => {
  assert.ok(STORY_STAGES.length >= 1);
  const stage1 = findStage(1, 1);
  assert.ok(stage1, 'findStage(1, 1) must return Stage 1');
  assert.equal(stage1.chapter, 1);
  assert.equal(stage1.index, 1);
  assert.ok(stage1.quota > 0);
  const byId = stageById(stage1.id);
  assert.equal(byId?.id, stage1.id);
  const chapter = stagesOfChapter(1);
  assert.ok(chapter.some((s) => s.id === stage1.id));
  assert.ok(lastAuthoredChapter() >= 1);
});

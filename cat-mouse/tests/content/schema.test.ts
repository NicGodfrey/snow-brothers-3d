import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ACHIEVEMENTS } from '../../src/content/achievements';
import { BREEDS } from '../../src/content/breeds';
import { CHAPTERS, STORY_STAGE_IDS } from '../../src/content/chapters';
import { DIALOGUE_TREES } from '../../src/content/dialogue';
import { buildStage } from '../../src/content/generators/stageFactory';
import { ITEMS, POWER_UP_KINDS } from '../../src/content/items';
import { PALETTES } from '../../src/content/palettes';
import { ARCADE_STAGES, STAGES, STAGES_BY_ID, STORY_STAGES, TIME_ATTACK_STAGES } from '../../src/content/registry';
import { THEME_IDS, TILE_LEGEND, isTileGlyph } from '../../src/content/schema';
import { validateStage } from '../../src/content/validate';

describe('content catalogs', () => {
  it('ships all twelve palettes', () => {
    assert.equal(PALETTES.length, 12);
    assert.deepEqual(PALETTES.map((p) => p.id), [...THEME_IDS]);
  });

  it('ships distinct cat breeds', () => {
    assert.ok(BREEDS.length >= 12);
    const ids = new Set(BREEDS.map((b) => b.id));
    assert.equal(ids.size, BREEDS.length);
    for (const breed of BREEDS) {
      assert.ok(breed.stats.chaseSpeed > breed.stats.patrolSpeed);
      assert.ok(breed.weights.patrol + breed.weights.ambush + breed.weights.camp + breed.weights.wander + breed.weights.nap > 0.5);
    }
  });

  it('covers every power-up kind', () => {
    assert.equal(POWER_UP_KINDS.length, 10);
    const kinds = new Set(ITEMS.map((item) => item.kind));
    assert.equal(kinds.size, ITEMS.length);
    for (const kind of POWER_UP_KINDS) assert.ok(kinds.has(kind));
  });

  it('ships a full achievement table', () => {
    assert.ok(ACHIEVEMENTS.length >= 24);
    const ids = new Set(ACHIEVEMENTS.map((a) => a.id));
    assert.equal(ids.size, ACHIEVEMENTS.length);
  });

  it('ships branching dialogue trees', () => {
    assert.ok(DIALOGUE_TREES.length >= 12);
    for (const tree of DIALOGUE_TREES) {
      const nodeIds = new Set(tree.nodes.map((n) => n.id));
      assert.ok(nodeIds.has(tree.root));
      assert.ok(tree.nodes.length >= 3);
    }
  });

  it('defines twelve chapters with eight stage ids each', () => {
    assert.equal(CHAPTERS.length, 12);
    assert.equal(STORY_STAGE_IDS.length, 12);
    for (const chapter of CHAPTERS) {
      assert.equal(chapter.stageIds.length, 8);
    }
  });
});

describe('registered stages', () => {
  it('registers unique ids and the crumb-trail opener', () => {
    const ids = STAGES.map((stage) => stage.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(STAGES_BY_ID['ch01-s01-crumb-trail']);
    const opener = STAGES_BY_ID['ch01-s01-crumb-trail'];
    assert.equal(opener.theme, 'kitchen');
    assert.equal(opener.quota, 3);
    assert.ok(opener.entities.some((e) => e.type === 'cheese'));
    assert.ok(opener.entities.some((e) => e.type === 'cat'));
    assert.ok(opener.entities.some((e) => e.type === 'hole'));
    assert.ok(opener.tiles.some((row) => row.includes('#')));
  });

  it('meets minimum mode counts', () => {
    assert.ok(STORY_STAGES.length >= 16, `story ${STORY_STAGES.length}`);
    assert.ok(ARCADE_STAGES.length >= 4, `arcade ${ARCADE_STAGES.length}`);
    assert.ok(TIME_ATTACK_STAGES.length >= 4, `timeAttack ${TIME_ATTACK_STAGES.length}`);
  });

  it('validates tile and decor dimensions for every stage', () => {
    assert.ok(STAGES.length > 0);
    const failures: string[] = [];
    for (const stage of STAGES) {
      if (stage.tiles.length !== stage.height) {
        failures.push(`${stage.id} tiles rows ${stage.tiles.length} != height ${stage.height}`);
      }
      if (stage.decor.length !== stage.height) {
        failures.push(`${stage.id} decor rows ${stage.decor.length} != height ${stage.height}`);
      }
      for (let y = 0; y < stage.tiles.length; y += 1) {
        const row = stage.tiles[y] ?? '';
        if (row.length !== stage.width) {
          failures.push(`${stage.id} tiles[${y}] width ${row.length} != ${stage.width}`);
        }
        for (let x = 0; x < row.length; x += 1) {
          const ch = row[x] ?? '';
          if (!isTileGlyph(ch) || !(ch in TILE_LEGEND)) {
            failures.push(`${stage.id} unknown glyph '${ch}' at ${x},${y}`);
          }
        }
      }
      for (let y = 0; y < stage.decor.length; y += 1) {
        const row = stage.decor[y] ?? '';
        if (row.length !== stage.width) {
          failures.push(`${stage.id} decor[${y}] width ${row.length} != ${stage.width}`);
        }
      }
      const issues = validateStage(stage);
      for (const issue of issues) failures.push(`${stage.id} ${issue.path} ${issue.message}`);
    }
    assert.equal(failures.length, 0, failures.slice(0, 20).join('\n'));
  });

  it('keeps layouts unique', () => {
    const fingerprints = new Map<string, string>();
    for (const stage of STAGES) {
      const key = stage.tiles.join('|');
      const prior = fingerprints.get(key);
      assert.equal(prior, undefined, `duplicate layout ${stage.id} vs ${prior}`);
      fingerprints.set(key, stage.id);
    }
  });
});

describe('stage factory', () => {
  it('builds a valid deterministic stage', () => {
    const a = buildStage({
      id: 'factory-probe-cellar',
      name: 'Factory Probe',
      chapter: 2,
      index: 3,
      theme: 'cellar',
      kind: 'story',
      seed: 424242,
    });
    const b = buildStage({
      id: 'factory-probe-cellar',
      name: 'Factory Probe',
      chapter: 2,
      index: 3,
      theme: 'cellar',
      kind: 'story',
      seed: 424242,
    });
    assert.deepEqual(a.tiles, b.tiles);
    assert.equal(validateStage(a).length, 0);
    assert.equal(a.tiles.length, a.height);
    assert.ok(a.tiles.every((row) => row.length === a.width));
  });
});

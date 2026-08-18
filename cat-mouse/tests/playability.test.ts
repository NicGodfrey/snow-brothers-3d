import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { tryLoadSrc } from './helpers/loadSrc';
import type { StageDef } from '../src/content/schema';

const req = createRequire(__filename);

function walkJs(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkJs(full, acc);
    else if (extname(full) === '.js') acc.push(full);
  }
  return acc;
}

function asStage(value: unknown): StageDef | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (!Array.isArray(v.tiles)) return null;
  if (typeof v.width !== 'number' || typeof v.height !== 'number') return null;
  if (typeof v.quota !== 'number' || !Array.isArray(v.entities)) return null;
  if (typeof v.id !== 'string') return null;
  return value as StageDef;
}

function collectFromModule(mod: object, into: StageDef[], seen: Set<string>): void {
  const visit = (value: unknown): void => {
    const stage = asStage(value);
    if (stage && !seen.has(stage.id)) {
      seen.add(stage.id);
      into.push(stage);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === 'object') {
      for (const inner of Object.values(value as Record<string, unknown>)) {
        if (asStage(inner) || Array.isArray(inner)) visit(inner);
      }
    }
  };
  visit(mod);
  for (const value of Object.values(mod as Record<string, unknown>)) visit(value);
}

function collectStages(): StageDef[] {
  const stages: StageDef[] = [];
  const seen = new Set<string>();
  const registry = tryLoadSrc<Record<string, unknown>>('content/registry');
  if (registry) {
    const list =
      (typeof registry.listStages === 'function' ? registry.listStages() : undefined) ??
      (typeof registry.allStages === 'function' ? registry.allStages() : undefined) ??
      registry.STAGES ??
      registry.stages ??
      registry.all;
    if (Array.isArray(list)) {
      for (const item of list) {
        const stage = asStage(item) ?? asStage((item as { def?: unknown })?.def);
        if (stage && !seen.has(stage.id)) {
          seen.add(stage.id);
          stages.push(stage);
        }
      }
    }
    const getter = registry.getStage ?? registry.stageById ?? registry.loadStage;
    if (typeof getter === 'function') {
      for (const id of ['story-1-1', 'story-01-01', 'c01s01', '1-1', 'ch1-st1']) {
        try {
          const got = getter(id);
          const stage = asStage(got) ?? asStage((got as { def?: unknown })?.def);
          if (stage && !seen.has(stage.id)) {
            seen.add(stage.id);
            stages.push(stage);
          }
        } catch {
          // id not present on this registry
        }
      }
    }
    collectFromModule(registry, stages, seen);
  }

  const contentDir = join(__dirname, '../src/content');
  for (const file of walkJs(contentDir)) {
    let mod: unknown;
    try {
      mod = req(file);
    } catch {
      continue;
    }
    if (mod && typeof mod === 'object') collectFromModule(mod, stages, seen);
  }
  return stages;
}

function isStage1(stage: StageDef): boolean {
  if (stage.kind === 'story' && stage.chapter === 1 && stage.index === 1) return true;
  if (stage.chapter === 1 && stage.index === 1) return true;
  const id = stage.id.toLowerCase();
  if (id === 'story-1-1' || id === 'story-01-01' || id === 'c01s01' || id === 'ch1-st1') return true;
  if (/chapter[-_]?0*1/.test(id) && /stage[-_]?0*1/.test(id)) return true;
  return false;
}

test('Stage 1 definition loads and is structurally playable', () => {
  const stages = collectStages();
  const stage = stages.find(isStage1);
  assert.ok(
    stage,
    `Stage 1 definition is missing (story chapter 1 index 1). found ${stages.length} stage(s): ${
      stages.map((s) => s.id).join(', ') || '(none)'
    }`,
  );

  assert.ok(stage.quota > 0, `Stage 1 quota must be > 0, got ${stage.quota}`);

  const catSpawn = stage.entities.some((entity) => entity.type === 'cat');
  assert.ok(catSpawn, 'Stage 1 must include at least one cat spawn');

  const holeEntity = stage.entities.some((entity) => entity.type === 'hole');
  const holeTile = stage.tiles.some((row) => row.includes('o'));
  assert.ok(holeEntity || holeTile, 'Stage 1 must include a hole (entity type hole or tile glyph o)');

  assert.equal(
    stage.tiles.length,
    stage.height,
    `tiles row count (${stage.tiles.length}) must equal height (${stage.height})`,
  );
  for (let y = 0; y < stage.tiles.length; y += 1) {
    const row = stage.tiles[y] as string;
    assert.equal(
      row.length,
      stage.width,
      `tiles[${y}] length ${row.length} must equal width ${stage.width}`,
    );
  }
});

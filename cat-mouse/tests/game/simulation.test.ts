import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { StageDef } from '../../src/content/schema';
import { createSimulation } from '../../src/game/simulation';
import { FrameInput } from '../../src/game/input';
import { DEFAULT_STEP } from '../../src/engine/loop';

function makeStage(over: Partial<StageDef> = {}): StageDef {
  const tiles = over.tiles ?? [
    '##########',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '#........#',
    '##########',
  ];
  const width = tiles[0]!.length;
  const height = tiles.length;
  return {
    id: 'test-cellar-1',
    chapter: 1,
    index: 1,
    name: 'Test Cellar',
    theme: 'cellar',
    kind: 'story',
    seed: 11,
    width,
    height,
    tileSize: 16,
    tiles,
    decor: tiles.map((row) => ' '.repeat(row.length)),
    spawn: { x: 2, y: 2 },
    entities: [],
    lights: [{ x: 4, y: 4, radius: 8, intensity: 1, on: true }],
    patrols: [],
    dialogue: [],
    hints: {
      ambushSpots: [],
      searchSpots: [],
      aggression: 1,
      scentBias: 1,
      hearingBias: 1,
      campHoleChance: 0,
      leashRadius: 40,
    },
    objectives: [{ kind: 'quota', value: 1, optional: false, label: 'Bank cheese' }],
    quota: 1,
    parTime: 90,
    lives: 3,
    ambient: 1,
    difficulty: 1,
    music: 'test',
    tags: ['test'],
    ...over,
    tiles: over.tiles ?? tiles,
    width: (over.tiles ?? tiles)[0]!.length,
    height: (over.tiles ?? tiles).length,
  };
}

describe('simulation', () => {
  it('loads a stage into a playable runtime', () => {
    const sim = createSimulation(
      makeStage({
        entities: [
          { type: 'cheese', x: 3, y: 2, value: 1 },
          { type: 'hole', x: 2, y: 2 },
          { type: 'cat', x: 8, y: 8, breed: 'ragdoll' },
        ],
      }),
    );
    assert.equal(sim.outcome, 'playing');
    assert.ok(sim.stage.mouse);
    assert.equal(sim.stage.cheeses.length, 1);
    assert.ok(sim.stage.holes.length >= 1);
    assert.equal(sim.stage.cats.length, 1);
    assert.equal(sim.stage.tiles.at(0, 0), 'wall');
  });

  it('wins after collecting and banking the quota', () => {
    const sim = createSimulation(
      makeStage({
        spawn: { x: 2, y: 2 },
        entities: [
          { type: 'cheese', x: 3, y: 2, value: 1 },
          { type: 'hole', x: 5, y: 2 },
        ],
        quota: 1,
      }),
    );
    const input = new FrameInput().setAxis(1, 0);
    let outcome = sim.outcome;
    for (let i = 0; i < 240 && outcome === 'playing'; i += 1) {
      input.press('interact');
      outcome = sim.step(input, DEFAULT_STEP);
      input.endFrame();
    }
    assert.equal(outcome, 'won');
    assert.ok(sim.stage.score.cheeseBanked >= 1);
    assert.ok((sim.stage.result?.stars ?? 0) >= 1);
  });

  it('loses when the last life is spent', () => {
    const sim = createSimulation(
      makeStage({
        spawn: { x: 4, y: 4 },
        lives: 1,
        entities: [{ type: 'cat', x: 4, y: 4, breed: 'bengal' }],
      }),
    );
    let outcome = sim.outcome;
    for (let i = 0; i < 30 && outcome === 'playing'; i += 1) {
      outcome = sim.step(new FrameInput(), DEFAULT_STEP);
    }
    assert.equal(outcome, 'lost');
    assert.equal(sim.stage.mouse.lives, 0);
  });

  it('lets a cat catch a mouse that is not invulnerable', () => {
    const sim = createSimulation(
      makeStage({
        spawn: { x: 4, y: 4 },
        lives: 3,
        entities: [{ type: 'cat', x: 4, y: 4, breed: 'siamese' }],
      }),
    );
    const before = sim.stage.mouse.lives;
    for (let i = 0; i < 20; i += 1) sim.step(new FrameInput(), DEFAULT_STEP);
    assert.ok(sim.stage.score.catches >= 1 || sim.stage.mouse.lives < before);
  });

  it('is deterministic for the same seed and idle input', () => {
    const def = makeStage({
      seed: 99,
      entities: [
        { type: 'cheese', x: 5, y: 5, value: 1 },
        { type: 'cat', x: 7, y: 2, breed: 'tabby', patrol: 1 },
      ],
      patrols: [{ id: 1, loop: true, pauseSeconds: 0, points: [{ x: 7, y: 2 }, { x: 7, y: 6 }] }],
    });
    const a = createSimulation(def, { seed: 99 });
    const b = createSimulation(def, { seed: 99 });
    for (let i = 0; i < 45; i += 1) {
      a.step(new FrameInput(), DEFAULT_STEP);
      b.step(new FrameInput(), DEFAULT_STEP);
    }
    assert.equal(a.stage.mouse.transform.x, b.stage.mouse.transform.x);
    assert.equal(a.stage.cats[0]!.state, b.stage.cats[0]!.state);
    assert.equal(a.stage.score.timeSeconds, b.stage.score.timeSeconds);
  });
});

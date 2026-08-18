import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../src/engine/rng';
import { createMouse } from '../../src/game/mouse';
import { createCat } from '../../src/game/cat';
import { tickBrain, setCatState, type BrainContext } from '../../src/game/brain';
import { makeOpenTiles } from '../../src/game/tiles';
import { ScentField } from '../../src/game/senses';
import type { CatRuntime, MouseRuntime } from '../../src/game/types';

function ctx(cat: CatRuntime, mouse: MouseRuntime, extra: Partial<BrainContext> = {}): BrainContext {
  const tiles = extra.tiles ?? makeOpenTiles(16, 16);
  return {
    cat,
    mouse,
    tiles,
    scent: extra.scent ?? new ScentField(16, 16),
    decoys: extra.decoys ?? [],
    holes: extra.holes ?? [],
    lights: extra.lights ?? [],
    dt: extra.dt ?? 1 / 30,
    rng: extra.rng ?? makeRng(3),
    intensity: extra.intensity ?? 0.2,
    aggression: extra.aggression ?? 1,
    scentBias: extra.scentBias ?? 1,
    hearingBias: extra.hearingBias ?? 1,
    campHoleChance: extra.campHoleChance ?? 0,
    leashRadius: extra.leashRadius ?? 40,
    ambushSpots: extra.ambushSpots ?? [],
    searchSpots: extra.searchSpots ?? [],
    noise: extra.noise ?? null,
    ambient: extra.ambient ?? 1,
    events: extra.events,
  };
}

describe('cat brain', () => {
  it('stays on patrol with no stimulus', () => {
    const cat = createCat(1, 8.5, 8.5, 'tabby', [{ x: 10.5, y: 8.5 }, { x: 8.5, y: 8.5 }]);
    cat.transform.facing = 0;
    const mouse = createMouse(2, 2.5, 2.5);
    mouse.lastNoise = 0;
    const state = tickBrain(ctx(cat, mouse));
    assert.equal(state, 'patrol');
  });

  it('chases a mouse spotted in the sight cone', () => {
    const cat = createCat(1, 5.5, 5.5);
    cat.transform.facing = 0;
    const mouse = createMouse(2, 8.5, 5.5);
    const state = tickBrain(ctx(cat, mouse));
    assert.equal(state, 'chase');
    assert.ok(cat.lastKnown);
    assert.ok(cat.suspicion >= 1);
  });

  it('pounces when the spotted mouse is in range', () => {
    const cat = createCat(1, 5.5, 5.5);
    cat.transform.facing = 0;
    cat.pounceCooldown = 0;
    const mouse = createMouse(2, 6.6, 5.5);
    const state = tickBrain(ctx(cat, mouse));
    assert.equal(state, 'pounce');
  });

  it('turns suspicious after a loud noise', () => {
    const cat = createCat(1, 5.5, 5.5);
    cat.transform.facing = Math.PI;
    const mouse = createMouse(2, 12.5, 12.5);
    mouse.lastNoise = 0;
    const noise = { x: 6.5, y: 5.5, loudness: 3, age: 0 };
    const state = tickBrain(ctx(cat, mouse, { noise }));
    assert.ok(state === 'suspicious' || state === 'investigate', state);
    assert.ok(cat.suspicion > 0);
  });

  it('drops from chase into search after memory expires', () => {
    const cat = createCat(1, 5.5, 5.5);
    cat.transform.facing = 0;
    setCatState(cat, 'chase');
    cat.lastKnown = { x: 8, y: 5.5 };
    cat.memoryTimer = 0;
    const mouse = createMouse(2, 2.5, 12.5);
    mouse.lastNoise = 0;
    const state = tickBrain(ctx(cat, mouse));
    assert.equal(state, 'search');
  });

  it('wakes from a nap on a loud noise', () => {
    const cat = createCat(1, 5.5, 5.5);
    cat.transform.facing = Math.PI;
    setCatState(cat, 'nap');
    const mouse = createMouse(2, 14.5, 14.5);
    mouse.lastNoise = 0;
    const state = tickBrain(ctx(cat, mouse, { noise: { x: 5.6, y: 5.5, loudness: 4, age: 0 } }));
    assert.equal(state, 'suspicious');
  });

  it('does not change plan while frozen', () => {
    const cat = createCat(1, 5.5, 5.5);
    cat.transform.facing = 0;
    cat.frozen = 2;
    const mouse = createMouse(2, 8.5, 5.5);
    const state = tickBrain(ctx(cat, mouse));
    assert.equal(state, 'patrol');
    assert.ok(cat.frozen < 2);
  });

  it('returns home then resumes patrol', () => {
    const cat = createCat(1, 8.5, 8.5, 'tabby', [{ x: 8.5, y: 8.5 }]);
    setCatState(cat, 'return');
    cat.homeX = 8.5;
    cat.homeY = 8.5;
    const mouse = createMouse(2, 1.5, 1.5);
    const state = tickBrain(ctx(cat, mouse));
    assert.equal(state, 'patrol');
  });
});

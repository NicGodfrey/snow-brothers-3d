/**
 * Integration cover for the first shipped story stage.
 *
 * The other simulation tests run against a synthetic room. These drive the
 * real `ch01-s01-crumb-trail` StageDef through the real simulation so a broken
 * layout, an unreachable hole, or an impossible quota fails the suite instead
 * of shipping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { findStage, stageById } from '../../src/content/registry';
import type { StageDef } from '../../src/content/schema';
import { createSimulation } from '../../src/game/simulation';
import { FrameInput } from '../../src/game/input';
import { findGridPath } from '../../src/game/nav';
import { DEFAULT_STEP } from '../../src/engine/loop';
import type { TileMapLike } from '../../src/engine/types';

const STAGE_ID = 'ch01-s01-crumb-trail';

function stageOne(): StageDef {
  const stage = stageById(STAGE_ID);
  assert.ok(stage, `${STAGE_ID} is missing from the stage registry`);
  return stage;
}

function withoutCats(stage: StageDef): StageDef {
  return { ...stage, entities: stage.entities.filter((entity) => entity.type !== 'cat') };
}

function tileOf(value: number): number {
  return Math.floor(value);
}

/** Reachable tile path between two world positions, or null. */
function pathBetween(tiles: TileMapLike, from: { x: number; y: number }, to: { x: number; y: number }) {
  const result = findGridPath(
    tiles,
    { x: tileOf(from.x), y: tileOf(from.y) },
    { x: tileOf(to.x), y: tileOf(to.y) },
    true,
    4000,
  );
  return result.found ? result.nodes : null;
}

interface AutopilotResult {
  outcome: string;
  banked: number;
  steps: number;
}

/**
 * Plays the stage: walk to each cheese, then to an exit hole, holding
 * `interact` so pickups and deposits fire. Re-paths every few frames so a
 * respawn after a catch does not strand the run.
 */
function autopilot(stage: StageDef, maxSteps: number): AutopilotResult {
  const sim = createSimulation(stage, { seed: stage.seed });
  const input = new FrameInput();
  const live = sim.stage;
  let outcome: string = sim.outcome;
  let waypoints: { x: number; y: number }[] = [];
  let repathIn = 0;
  let steps = 0;

  for (; steps < maxSteps && outcome === 'playing'; steps += 1) {
    const mouse = live.mouse.transform;

    if (repathIn <= 0 || waypoints.length === 0) {
      repathIn = 12;
      const openCheese = live.cheeses.filter((cheese) => !cheese.taken);
      const wantCheese = openCheese.length > 0 && live.mouse.carrying < live.mouse.carryCapacity;
      const goal = wantCheese
        ? nearest(openCheese, mouse)
        : nearest(
            live.holes.filter((hole) => hole.isExit),
            mouse,
          ) ?? nearest(live.holes, mouse);

      if (goal) {
        const nodes = pathBetween(live.tiles, mouse, goal);
        waypoints = nodes
          ? nodes.map((node) => ({ x: node.x + 0.5, y: node.y + 0.5 })).slice(1)
          : [{ x: goal.x, y: goal.y }];
        if (waypoints.length === 0) waypoints = [{ x: goal.x, y: goal.y }];
      }
    }
    repathIn -= 1;

    let next = waypoints[0];
    while (next && Math.hypot(next.x - mouse.x, next.y - mouse.y) < 0.25) {
      waypoints.shift();
      next = waypoints[0];
    }

    if (next) {
      input.setAxis(next.x - mouse.x, next.y - mouse.y);
    } else {
      input.setAxis(0, 0);
    }
    input.press('interact');

    outcome = sim.step(input, DEFAULT_STEP);
    input.endFrame();
  }

  return { outcome, banked: live.score.cheeseBanked, steps };
}

function nearest<T extends { x: number; y: number }>(items: readonly T[], from: { x: number; y: number }): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    const d = Math.hypot(item.x - from.x, item.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

describe('stage one: ch01-s01-crumb-trail', () => {
  it('is registered as chapter 1 stage 1', () => {
    const stage = stageOne();
    assert.equal(stage.id, STAGE_ID);
    assert.equal(stage.chapter, 1);
    assert.equal(stage.index, 1);
    assert.equal(stage.kind, 'story');
    assert.equal(findStage(1, 1)?.id, STAGE_ID);
  });

  it('has a layout that matches its declared size', () => {
    const stage = stageOne();
    assert.equal(stage.tiles.length, stage.height);
    for (const row of stage.tiles) {
      assert.equal(row.length, stage.width, `row "${row}" is not ${stage.width} wide`);
    }
    assert.ok(stage.quota > 0);
    assert.ok(stage.lives > 0);
    assert.ok(stage.tileSize > 0);
  });

  it('spawns the mouse on a walkable tile with enough cheese for the quota', () => {
    const stage = stageOne();
    const sim = createSimulation(stage, { seed: stage.seed });
    const tiles = sim.stage.tiles;

    assert.equal(
      tiles.props(stage.spawn.x, stage.spawn.y).solid,
      false,
      'mouse spawn must not be inside a solid tile',
    );

    const cheeseValue = sim.stage.cheeses.reduce((sum, cheese) => sum + cheese.value, 0);
    assert.ok(
      cheeseValue >= stage.quota,
      `stage carries ${cheeseValue} cheese but demands a quota of ${stage.quota}`,
    );
    assert.ok(sim.stage.holes.length > 0, 'stage needs at least one hole to bank cheese');
    assert.ok(sim.stage.cats.length > 0, 'stage one should still have a hunter');
  });

  it('can path from the spawn to every cheese and on to an exit hole', () => {
    const stage = stageOne();
    const sim = createSimulation(stage, { seed: stage.seed });
    const tiles = sim.stage.tiles;
    const spawn = sim.stage.mouse.transform;
    const exits = sim.stage.holes.filter((hole) => hole.isExit);
    assert.ok(exits.length > 0, 'stage needs an exit hole');

    for (const cheese of sim.stage.cheeses) {
      assert.ok(pathBetween(tiles, spawn, cheese), `cheese at ${cheese.x},${cheese.y} is unreachable from spawn`);
      const toExit = exits.some((exit) => pathBetween(tiles, cheese, exit));
      assert.ok(toExit, `no exit hole is reachable from cheese at ${cheese.x},${cheese.y}`);
    }
  });

  it('is winnable: an autopilot banks the quota when the cat is away', () => {
    const stage = withoutCats(stageOne());
    const run = autopilot(stage, 5400);
    assert.equal(run.outcome, 'won', `autopilot ended as "${run.outcome}" after ${run.steps} steps`);
    assert.ok(run.banked >= stage.quota, `banked ${run.banked} of ${stage.quota}`);
  });

  it('banks cheese even with the hunter live on the stage', () => {
    const run = autopilot(stageOne(), 5400);
    assert.ok(run.banked >= 1, `autopilot banked nothing in ${run.steps} steps (outcome "${run.outcome}")`);
  });
});

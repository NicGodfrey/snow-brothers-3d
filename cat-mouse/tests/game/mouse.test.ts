import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng } from '../../src/engine/rng';
import { createMouse, emptyMouseWorld, mouseStep, catchMouse, tryDash, dropDecoy } from '../../src/game/mouse';
import { createCheese } from '../../src/game/cheese';
import { createHole } from '../../src/game/holes';
import { makeOpenTiles } from '../../src/game/tiles';
import { FrameInput } from '../../src/game/input';
import { hasStatus } from '../../src/game/status';
import { DEFAULT_MOUSE_STATS } from '../../src/game/defaults';
import { usePowerUp } from '../../src/game/powerups';

const DT = 1 / 60;

function setup(x = 4.5, y = 4.5) {
  const tiles = makeOpenTiles(12, 12);
  const rng = makeRng(7);
  const world = emptyMouseWorld(tiles, rng);
  const mouse = createMouse(1, x, y);
  return { tiles, rng, world, mouse };
}

function close(a: number, b: number, eps = 1e-3): void {
  assert.ok(Math.abs(a - b) <= eps, `${a} !== ${b} (eps ${eps})`);
}

describe('mouse', () => {
  it('walks in the input direction', () => {
    const { mouse, world } = setup();
    const startX = mouse.transform.x;
    const input = new FrameInput().setAxis(1, 0);
    for (let i = 0; i < 30; i += 1) mouseStep(mouse, input, world, DT);
    assert.ok(mouse.transform.x > startX + 0.8);
    assert.equal(mouse.stance, 'walk');
  });

  it('sneaks slower and quieter than a walk', () => {
    const walk = setup();
    const sneak = setup();
    const walkIn = new FrameInput().setAxis(1, 0);
    const sneakIn = new FrameInput().setAxis(1, 0).hold('sneak');
    let walkNoise = 0;
    let sneakNoise = 0;
    for (let i = 0; i < 20; i += 1) {
      walkNoise = mouseStep(walk.mouse, walkIn, walk.world, DT).noise;
      sneakNoise = mouseStep(sneak.mouse, sneakIn, sneak.world, DT).noise;
    }
    const walkDx = walk.mouse.transform.x - 4.5;
    const sneakDx = sneak.mouse.transform.x - 4.5;
    assert.ok(sneakDx < walkDx * 0.7, `sneak ${sneakDx} walk ${walkDx}`);
    assert.ok(sneakNoise < walkNoise);
    assert.equal(sneak.mouse.stance, 'sneak');
  });

  it('dashes consume stamina and cover ground quickly', () => {
    const { mouse, world } = setup();
    const start = mouse.transform.x;
    const stamina = mouse.stamina;
    const input = new FrameInput().setAxis(1, 0).press('dash');
    const first = mouseStep(mouse, input, world, DT);
    assert.ok(mouse.stamina < stamina);
    assert.equal(mouse.stance, 'dash');
    assert.ok(first.noise > DEFAULT_MOUSE_STATS.noiseWalk);
    input.endFrame();
    for (let i = 0; i < 10; i += 1) mouseStep(mouse, input.setAxis(1, 0), world, DT);
    assert.ok(mouse.transform.x - start > DEFAULT_MOUSE_STATS.walkSpeed * 10 * DT);
  });

  it('refuses a dash without stamina', () => {
    const { mouse } = setup();
    mouse.stamina = 0;
    assert.equal(tryDash(mouse, 1, 0), false);
    assert.equal(mouse.stance, 'idle');
  });

  it('regenerates stamina while walking', () => {
    const { mouse, world } = setup();
    mouse.stamina = 0.1;
    const input = new FrameInput().setAxis(0, 1);
    for (let i = 0; i < 40; i += 1) mouseStep(mouse, input, world, DT);
    assert.ok(mouse.stamina > 0.1);
  });

  it('does not walk through walls', () => {
    const { mouse, world } = setup(1.5, 5.5);
    const input = new FrameInput().setAxis(-1, 0);
    for (let i = 0; i < 40; i += 1) mouseStep(mouse, input, world, DT);
    assert.ok(mouse.transform.x >= 1.2);
  });

  it('picks up cheese on interact and banks it at a hole', () => {
    const { mouse, world } = setup(3.5, 3.5);
    world.cheeses.push(createCheese(20, 3.6, 3.5, 1, false));
    world.holes.push(createHole(21, 3.5, 3.5, true, -1));
    const grab = new FrameInput().press('interact');
    mouseStep(mouse, grab, world, DT);
    assert.equal(mouse.carrying, 1);
    assert.equal(world.cheeses[0]!.taken, true);
    grab.endFrame();
    const bank = new FrameInput().press('interact');
    mouseStep(mouse, bank, world, DT);
    assert.equal(mouse.carrying, 0);
    assert.equal(world.score.cheeseBanked, 1);
  });

  it('drops a decoy when crumbs remain', () => {
    const { mouse, world } = setup();
    mouse.crumbs = 1;
    const decoy = dropDecoy(mouse, world.decoys, world.allocateEntity);
    assert.ok(decoy);
    assert.equal(mouse.crumbs, 0);
    assert.equal(world.decoys.length, 1);
    assert.equal(dropDecoy(mouse, world.decoys, world.allocateEntity), null);
  });

  it('uses a speed power-up to apply haste', () => {
    const { mouse } = setup();
    mouse.heldPowerUp = 'speed';
    const used = usePowerUp(mouse, []);
    assert.equal(used.used, true);
    assert.ok(hasStatus(mouse.statuses, 'hasted'));
    assert.equal(mouse.heldPowerUp, null);
  });

  it('loses a life and respawns when caught', () => {
    const { mouse, world } = setup(4.5, 4.5);
    mouse.spawnX = 2.5;
    mouse.spawnY = 2.5;
    mouse.carrying = 2;
    const ok = catchMouse(mouse, world, 4.5, 4.5);
    assert.equal(ok, true);
    assert.equal(mouse.lives, 2);
    close(mouse.transform.x, 2.5);
    close(mouse.transform.y, 2.5);
    assert.ok(mouse.invulnerable > 0);
    assert.equal(mouse.carrying, 0);
  });

  it('stays caught when lives run out', () => {
    const { mouse, world } = setup();
    mouse.lives = 1;
    catchMouse(mouse, world, 0, 0);
    assert.equal(mouse.lives, 0);
    assert.equal(mouse.stance, 'caught');
    const x = mouse.transform.x;
    mouseStep(mouse, new FrameInput().setAxis(1, 0), world, DT);
    close(mouse.transform.x, x);
  });

  it('ignores a catch while invulnerable', () => {
    const { mouse, world } = setup();
    mouse.invulnerable = 1;
    const lives = mouse.lives;
    assert.equal(catchMouse(mouse, world, 0, 0), false);
    assert.equal(mouse.lives, lives);
  });

  it('cannot move while stunned', () => {
    const { mouse, world } = setup();
    mouse.statuses.push({ kind: 'stunned', remaining: 1, magnitude: 1, source: 'test' });
    const x = mouse.transform.x;
    mouseStep(mouse, new FrameInput().setAxis(1, 0), world, DT);
    close(mouse.transform.x, x, 1e-6);
  });
});

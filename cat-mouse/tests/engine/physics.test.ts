import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TileMap } from '../../src/engine/tiles';
import {
  aabbHitsTiles,
  aabbIntersects,
  aabbPenetration,
  circleHitsTiles,
  circleRectPenetration,
  circlesOverlap,
  moveAabb,
  moveCircle,
  queryTileTriggers,
  queryTriggers,
  raycastTiles,
  resolveOverlap,
  separate,
  stepAabb,
  stepBody,
  triggerHit,
} from '../../src/engine/physics';
import type { AabbBody, Body } from '../../src/engine/physics';

test('circleRectPenetration is null when separate and pushes out when overlapping', () => {
  assert.equal(circleRectPenetration({ x: 0, y: 0, r: 1 }, { x: 5, y: 5, w: 1, h: 1 }), null);
  const push = circleRectPenetration({ x: 5, y: 1, r: 2 }, { x: 0, y: 0, w: 10, h: 2 });
  assert.ok(push);
  assert.ok(Math.abs(push.y) > 0);
});

test('moveCircle slides along walls instead of entering them', () => {
  const map = TileMap.filled(8, 8, 16, 'floor');
  map.set(4, 3, 'wall');
  const startX = 16 * 3.5;
  const startY = 16 * 3.5;
  const moved = moveCircle(map, startX, startY, 4, 24, 0, true);
  assert.equal(moved.hitX, true);
  assert.ok(moved.x < startX + 24);
  assert.equal(map.tileAtWorld(moved.x, moved.y) === 'wall', false);
});

test('vents block cats and admit the mouse', () => {
  const map = TileMap.filled(6, 3, 16, 'floor');
  map.set(2, 1, 'vent');
  const x = 16 * 1.5;
  const y = 16 * 1.5;
  const cat = moveCircle(map, x, y, 4, 20, 0, false);
  const mouse = moveCircle(map, x, y, 3, 20, 0, true);
  assert.equal(cat.hitX, true);
  assert.equal(mouse.hitX, false);
  assert.ok(mouse.x > cat.x);
});

test('outside the map counts as blocked', () => {
  const map = TileMap.filled(4, 4, 8, 'floor');
  assert.equal(circleHitsTiles(map, -2, 8, 3, true), true);
  assert.equal(circleHitsTiles(map, 8, 8, 2, true), false);
});

test('resolveOverlap and stepBody zero velocity on hit', () => {
  const map = TileMap.filled(5, 5, 16, 'floor');
  map.set(2, 2, 'wall');
  const pushed = resolveOverlap(map, 16 * 2.1, 16 * 2.1, 6, true);
  assert.equal(map.tileAtWorld(pushed.x, pushed.y) === 'wall', false);
  const body: Body = { x: 24, y: 24, vx: 80, vy: 0, radius: 4, allowMouseOnly: true };
  map.set(3, 1, 'wall');
  const result = stepBody(map, body, 0.2);
  if (result.hitX) assert.equal(body.vx, 0);
  assert.equal(body.x, result.x);
});

test('triggers, circle overlap, separate, raycast', () => {
  const trigger = { id: 'hole', x: 10, y: 10, radius: 4, enabled: true };
  assert.equal(triggerHit(trigger, 10, 10, 1), true);
  assert.equal(triggerHit({ ...trigger, enabled: false }, 10, 10, 1), false);
  assert.equal(queryTriggers([trigger], 10, 10, 1).length, 1);
  assert.equal(circlesOverlap(0, 0, 2, 3, 0, 2), true);
  assert.equal(circlesOverlap(0, 0, 1, 5, 0, 1), false);

  const a: Body = { x: 0, y: 0, vx: 0, vy: 0, radius: 4, allowMouseOnly: true };
  const b: Body = { x: 2, y: 0, vx: 0, vy: 0, radius: 4, allowMouseOnly: true };
  separate(a, b, 1);
  assert.ok(b.x - a.x > 2);

  const map = TileMap.filled(8, 8, 16, 'floor');
  map.set(4, 1, 'wall');
  const hit = raycastTiles(map, 16 * 1.5, 16 * 1.5, 1, 0, 80, true);
  assert.equal(hit.hit, true);
  const clear = raycastTiles(map, 16 * 1.5, 16 * 6.5, 1, 0, 40, true);
  assert.equal(clear.hit, false);
});

test('AABB overlap and penetration', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  const b = { x: 8, y: 0, w: 10, h: 10 };
  assert.equal(aabbIntersects(a, b), true);
  assert.equal(aabbIntersects(a, { x: 20, y: 0, w: 1, h: 1 }), false);
  const push = aabbPenetration(a, b);
  assert.ok(push);
  assert.ok(Math.abs(push.x) > 0);
  assert.equal(push.y, 0);
});

test('moveAabb stops against walls', () => {
  const map = TileMap.filled(8, 8, 16, 'floor');
  map.set(4, 3, 'wall');
  const box = { x: 16 * 2.2, y: 16 * 3.2, w: 8, h: 8 };
  const moved = moveAabb(map, box, 40, 0, true);
  assert.equal(moved.hitX, true);
  assert.ok(moved.x < box.x + 40);
  assert.equal(aabbHitsTiles(map, { x: 16 * 4.1, y: 16 * 3.1, w: 8, h: 8 }, true), true);
});

test('one-way tiles land from above and pass from below', () => {
  const map = TileMap.filled(6, 6, 16, 'floor');
  for (let x = 0; x < 6; x += 1) map.set(x, 3, 'oneWay');
  const above = moveCircle(map, 24, 16 * 2.4, 4, 0, 30, true);
  assert.equal(above.hitY, true);
  assert.ok(above.y + 4 <= 16 * 3 + 2);
  const below = moveCircle(map, 24, 16 * 4.2, 4, 0, -30, true);
  assert.equal(below.hitY, false);
  assert.ok(below.y < 16 * 4.2);
  const aabbDown = moveAabb(map, { x: 20, y: 16 * 2.1, w: 8, h: 6 }, 0, 40, true);
  assert.equal(aabbDown.hitY, true);
  const aabbUp = moveAabb(map, { x: 20, y: 16 * 4.1, w: 8, h: 6 }, 0, -40, true);
  assert.equal(aabbUp.hitY, false);
});

test('tile triggers report holes and water under a body', () => {
  const map = TileMap.filled(4, 4, 16, 'floor');
  map.set(1, 1, 'hole');
  map.set(2, 1, 'water');
  const hits = queryTileTriggers(map, 16 * 1.5, 16 * 1.5, 6);
  assert.ok(hits.some((h) => h.kind === 'hole'));
  const body: AabbBody = { x: 8, y: 8, w: 6, h: 6, vx: 0, vy: 0, allowMouseOnly: true };
  const result = stepAabb(map, body, 0.1);
  assert.equal(result.x, body.x);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TileMap } from '../../src/engine/tiles';
import { findPath, pathToWorld, Pathfinder } from '../../src/engine/pathfinding';

test('findPath routes around solid tiles', () => {
  const map = TileMap.filled(10, 6, 16, 'floor');
  map.set(4, 2, 'wall');
  map.set(4, 3, 'wall');
  const result = findPath(map, { start: { x: 1, y: 2 }, goal: { x: 8, y: 2 }, allowMouseOnly: false });
  assert.equal(result.found, true);
  assert.ok(result.nodes.length > 2);
  assert.ok(!result.nodes.some((n) => n.x === 4 && n.y === 2));
  const world = pathToWorld(result.nodes, 16);
  assert.equal(world.length, result.nodes.length);
});

test('mouse-only vents are closed to cats', () => {
  const map = TileMap.filled(5, 3, 16, 'wall');
  map.set(1, 1, 'floor');
  map.set(2, 1, 'vent');
  map.set(3, 1, 'floor');
  const cat = findPath(map, { start: { x: 1, y: 1 }, goal: { x: 3, y: 1 }, allowMouseOnly: false });
  const mouse = findPath(map, { start: { x: 1, y: 1 }, goal: { x: 3, y: 1 }, allowMouseOnly: true });
  assert.equal(cat.found, false);
  assert.equal(mouse.found, true);
  const finder = new Pathfinder(map, { allowMouseOnly: true });
  assert.equal(finder.find({ x: 1, y: 1 }, { x: 3, y: 1 }).found, true);
});

test('start equals goal and walled-in goals', () => {
  const map = TileMap.filled(6, 4, 16, 'floor');
  const same = findPath(map, { start: { x: 1, y: 1 }, goal: { x: 1, y: 1 } });
  assert.equal(same.found, true);
  assert.equal(same.cost, 0);
  map.set(4, 2, 'wall');
  const fail = findPath(map, { start: { x: 1, y: 1 }, goal: { x: 4, y: 2 } });
  assert.equal(fail.found, false);
  assert.equal(fail.cost, Infinity);
});

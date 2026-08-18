import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findGridPath, nearestWalkable, pathToWorld } from '../../src/game/nav';
import { makeOpenTiles } from '../../src/game/tiles';

test('findGridPath routes around walls', () => {
  const map = makeOpenTiles(9, 5, 1, true);
  map.setKind(4, 2, 'wall');
  const path = findGridPath(map, { x: 2, y: 2 }, { x: 6, y: 2 }, false);
  assert.equal(path.found, true);
  assert.ok(path.nodes.length > 2);
  assert.equal(path.nodes[0]?.x, 2);
  assert.equal(path.nodes[path.nodes.length - 1]?.x, 6);
  const world = pathToWorld(path.nodes);
  assert.equal(world.length, path.nodes.length);
});

test('nearestWalkable steps off a wall', () => {
  const map = makeOpenTiles(6, 6, 1, true);
  map.setKind(2, 2, 'wall');
  const open = nearestWalkable(map, 2, 2, true);
  assert.equal(map.solid(open.x, open.y), false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_GLYPHS,
  TILE_KIND_LIST,
  TILE_PROPS,
  TileMap,
  blocksAgent,
  tileProps,
  tileToWorld,
  worldToTile,
} from '../../src/engine/tiles';
import type { TileKind } from '../../src/engine/types';

test('TILE_PROPS covers every TileKind and walls block sight', () => {
  const kinds = Object.keys(TILE_PROPS) as TileKind[];
  assert.deepEqual([...kinds].sort(), [...TILE_KIND_LIST].sort());
  for (const kind of TILE_KIND_LIST) {
    assert.equal(TILE_PROPS[kind].kind, kind);
  }
  assert.ok(kinds.includes('floor'));
  assert.ok(kinds.includes('wall'));
  assert.ok(kinds.includes('vent'));
  assert.ok(kinds.includes('hole'));
  assert.equal(tileProps('wall').solid, true);
  assert.equal(tileProps('wall').opaque, true);
  assert.equal(tileProps('floor').solid, false);
  assert.equal(tileProps('vent').mouseOnly, true);
  assert.equal(blocksAgent('wall', true), true);
  assert.equal(blocksAgent('floor', false), false);
  assert.equal(blocksAgent('vent', false), true);
  assert.equal(blocksAgent('vent', true), false);
  assert.equal(blocksAgent('hole', false), true);
  assert.equal(blocksAgent('hole', true), false);
});

test('TileMap stores a grid and rejects the wrong length', () => {
  assert.throws(() => new TileMap({ width: 2, height: 2, tileSize: 16, tiles: ['floor'] }));
  const map = TileMap.filled(4, 3, 16, 'floor');
  map.set(1, 1, 'wall');
  assert.equal(map.at(1, 1), 'wall');
  assert.equal(map.at(-1, 0), 'void');
  assert.equal(map.solid(1, 1), true);
  assert.equal(map.solid(0, 0), false);
  assert.equal(map.blocked(1, 1, true), true);
  assert.equal(map.index(1, 1), 5);
  assert.equal(map.pixelWidth, 64);
  assert.equal(map.pixelHeight, 48);
  assert.equal(map.toTileX(16), 1);
  assert.equal(map.toWorldX(1), 24);
  assert.equal(map.tileAtWorld(24, 24), 'wall');
});

test('mouse-only tiles block cats but not the mouse', () => {
  const map = TileMap.filled(3, 3, 8, 'floor');
  map.set(1, 1, 'vent');
  assert.equal(map.blocked(1, 1, true), false);
  assert.equal(map.blocked(1, 1, false), true);
  assert.equal(map.cost(1, 1, false), Infinity);
  assert.ok(map.cost(1, 1, true) < Infinity);
});

test('neighbors do not cut corners and lineOfSight hits opaque tiles', () => {
  const map = TileMap.filled(5, 5, 16, 'floor');
  map.set(2, 1, 'wall');
  map.set(1, 2, 'wall');
  const open = map.neighbors(1, 1, true, true);
  assert.ok(!open.some((n) => n.x === 2 && n.y === 2));
  assert.equal(map.lineOfSight(0, 0, 4, 0), true);
  assert.equal(map.lineOfSight(2, 0, 2, 3), false);
  const near = map.nearestOpen(2, 1, true);
  assert.ok(near);
  assert.equal(map.blocked(near.x, near.y, true), false);
});

test('findTiles and clone', () => {
  const map = TileMap.filled(3, 2, 10, 'floor');
  map.set(2, 1, 'hole');
  const holes = map.findTiles((kind) => kind === 'hole');
  assert.equal(holes.length, 1);
  assert.equal(holes[0]?.x, map.toWorldX(2));
  const copy = map.clone();
  copy.set(0, 0, 'water');
  assert.equal(map.at(0, 0), 'floor');
  assert.equal(copy.at(0, 0), 'water');
});

test('world/tile conversion and fromGlyphs', () => {
  assert.deepEqual(worldToTile(24, 40, 16), { x: 1, y: 2 });
  assert.deepEqual(tileToWorld(1, 2, 16), { x: 24, y: 40 });
  const map = TileMap.fromGlyphs(['#.#', '.v.', '___'], 8);
  assert.equal(map.width, 3);
  assert.equal(map.height, 3);
  assert.equal(map.at(0, 0), 'wall');
  assert.equal(map.at(1, 1), 'vent');
  assert.equal(map.at(0, 2), 'oneWay');
  assert.equal(DEFAULT_GLYPHS['~'], 'water');
});

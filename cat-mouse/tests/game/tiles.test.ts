import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeOpenTiles,
  mouseHiddenAt,
  moveCircle,
  parseTileGlyph,
  tileBlocks,
  tilesFromRows,
} from '../../src/game/tiles';

test('parseTileGlyph and tilesFromRows honour the legend', () => {
  assert.equal(parseTileGlyph('#'), 'wall');
  assert.equal(parseTileGlyph('.'), 'floor');
  assert.equal(parseTileGlyph('o'), 'hole');
  assert.equal(parseTileGlyph('v'), 'vent');
  const map = tilesFromRows(['####', '#.o#', '#v.#', '####'], 4, 4, 1);
  assert.equal(map.at(1, 1), 'floor');
  assert.equal(map.at(2, 1), 'hole');
  assert.equal(tileBlocks(map, 0, 0, true), true);
  assert.equal(tileBlocks(map, 1, 2, true), false);
  assert.equal(tileBlocks(map, 1, 2, false), true);
  assert.equal(mouseHiddenAt(map, 1.5, 2.5), true);
});

test('moveCircle slides on walls', () => {
  const map = makeOpenTiles(8, 8, 1, true);
  const moved = moveCircle(1.5, 1.5, -4, 0, 0.3, 1, map, true);
  assert.equal(moved.hit, true);
  assert.ok(moved.x >= 1.5);
});

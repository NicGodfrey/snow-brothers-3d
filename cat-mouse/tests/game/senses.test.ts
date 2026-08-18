import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catCanSee, lightAt, lineOfSight, ScentField } from '../../src/game/senses';
import { makeOpenTiles } from '../../src/game/tiles';
import { makeTestCat } from '../helpers/actors';

test('line of sight is blocked by opaque tiles', () => {
  const map = makeOpenTiles(8, 3, 1, true);
  map.setKind(4, 1, 'wall');
  assert.equal(lineOfSight(map, 1, 1, 2, 1), true);
  assert.equal(lineOfSight(map, 2, 1, 6, 1), false);
});

test('catCanSee uses the sight cone and lights help range', () => {
  const map = makeOpenTiles(16, 8, 1, true);
  const cat = makeTestCat(2, 4);
  cat.transform.facing = 0;
  const dark = catCanSee(cat, 8, 4, map, [], 0.05);
  const lit = catCanSee(
    cat,
    8,
    4,
    map,
    [{ entity: 9, x: 8, y: 4, radius: 6, intensity: 1, on: true, switchId: '', color: '#fff' }],
    0.05,
  );
  assert.equal(dark.los, true);
  assert.equal(dark.visible, false);
  assert.equal(lit.visible, true);
  assert.ok(lightAt([{ entity: 1, x: 0, y: 0, radius: 4, intensity: 1, on: true, switchId: '', color: '#fff' }], 0, 0) > 0.2);
});

test('scent field stores a trail', () => {
  const field = new ScentField(8, 8);
  field.deposit(3.2, 3.2, 1);
  assert.ok(field.strength(3, 3) > 0);
});

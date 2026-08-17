import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScentField } from '../../src/engine/scent';
import { TileMap } from '../../src/engine/tiles';

test('deposit, sample, gradient and decay', () => {
  const field = new ScentField({ width: 8, height: 8 });
  field.deposit(4, 4, 4);
  assert.ok(field.strength(4, 4) >= 4);
  const before = field.strength(4, 4);
  field.decayStep(1);
  assert.ok(field.strength(4, 4) < before);
  field.deposit(6, 4, 8);
  const g = field.gradient(5, 4);
  assert.ok(g.x > 0);
});

test('water forgets scent faster than floor', () => {
  const map = TileMap.filled(5, 5, 16, 'floor');
  map.set(1, 1, 'water');
  const field = ScentField.fromMap(map);
  field.set(1, 1, 1);
  field.set(3, 1, 1);
  field.decayStep(1, map);
  assert.ok(field.strength(1, 1) < field.strength(3, 1));
});

test('diffuse does not leak through walls', () => {
  const map = TileMap.filled(5, 3, 16, 'floor');
  map.set(2, 1, 'wall');
  const field = ScentField.fromMap(map, { diffuse: 4 });
  field.deposit(1, 1, 10);
  field.diffuseStep(1, map, 4);
  assert.ok(field.strength(0, 1) > 0);
  assert.equal(field.strength(2, 1), 0);
  assert.equal(field.strength(3, 1), 0);
});

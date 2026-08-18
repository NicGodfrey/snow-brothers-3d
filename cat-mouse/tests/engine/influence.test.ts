import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InfluenceMap } from '../../src/engine/influence';

test('influence sources pull toward peaks', () => {
  const map = new InfluenceMap(10, 10);
  map.addSource({ x: 7, y: 4, strength: 4, radius: 3 });
  const peak = map.peak();
  assert.equal(peak.x, 7);
  assert.equal(peak.y, 4);
  const g = map.gradient(5, 4);
  assert.ok(g.x > 0);
  const before = map.sample(7, 4);
  map.decay(1, 2);
  assert.ok(map.sample(7, 4) < before);
});

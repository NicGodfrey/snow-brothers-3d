import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameGraph, SpatialHash } from '../../src/engine/spatial';

test('SpatialHash query returns inserted items and clear empties', () => {
  const hash = new SpatialHash<string>(32);
  hash.insert('a', { x: 0, y: 0, w: 10, h: 10 });
  hash.insertCircle('b', 80, 80, 4);
  assert.equal(hash.size, 2);
  assert.deepEqual([...hash.query({ x: 0, y: 0, w: 12, h: 12 })], ['a']);
  assert.equal(hash.queryCircle(80, 80, 8).includes('b'), true);
  hash.clear();
  assert.equal(hash.size, 0);
  assert.equal(hash.query({ x: 0, y: 0, w: 12, h: 12 }).length, 0);
});

test('FrameGraph averages samples', () => {
  const graph = new FrameGraph(3);
  graph.push(10);
  graph.push(20);
  graph.push(30);
  graph.push(40);
  assert.equal(graph.values().length, 3);
  assert.equal(graph.worst, 40);
  assert.ok(graph.fps > 0);
});

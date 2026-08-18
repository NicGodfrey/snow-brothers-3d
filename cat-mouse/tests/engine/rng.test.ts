import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mulberry32, fbm2, hashString, makeRng, seedFrom, valueNoise1, valueNoise2 } from '../../src/engine/rng';

test('same seed yields the same sequence', () => {
  const a = new Mulberry32(42);
  const b = makeRng(42);
  for (let i = 0; i < 32; i += 1) {
    assert.equal(a.next(), b.next());
  }
});

test('different seeds diverge', () => {
  const a = new Mulberry32(1);
  const b = new Mulberry32(2);
  const seqA = Array.from({ length: 8 }, () => a.next());
  const seqB = Array.from({ length: 8 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('next stays in [0, 1)', () => {
  const rng = new Mulberry32(99);
  for (let i = 0; i < 200; i += 1) {
    const n = rng.next();
    assert.ok(n >= 0 && n < 1, `got ${n}`);
  }
});

test('int is within [min, max)', () => {
  const rng = new Mulberry32(7);
  for (let i = 0; i < 80; i += 1) {
    const n = rng.int(3, 8);
    assert.ok(n >= 3 && n < 8);
  }
  assert.equal(rng.int(5, 5), 5);
  assert.equal(rng.int(9, 2), 9);
});

test('range, bool, pick, shuffle, weighted', () => {
  const rng = new Mulberry32(1234);
  const r = rng.range(10, 20);
  assert.ok(r >= 10 && r < 20);
  assert.equal(typeof rng.bool(), 'boolean');
  assert.equal(rng.pick(['only']), 'only');
  assert.throws(() => rng.pick([]));
  const items = [1, 2, 3, 4, 5];
  const shuffled = rng.shuffle([...items]);
  assert.deepEqual([...shuffled].sort((a, b) => a - b), items);
  const heavy = rng.weighted(['a', 'b', 'c'], (item) => (item === 'b' ? 10 : 0.01));
  assert.ok(['a', 'b', 'c'].includes(heavy));
});

test('state restore and fork are deterministic', () => {
  const rng = new Mulberry32(50);
  rng.next();
  rng.next();
  const snap = rng.state();
  const first = rng.next();
  rng.restore(snap);
  assert.equal(rng.next(), first);
  const parent = new Mulberry32(8);
  const childA = parent.fork(3);
  const childB = new Mulberry32(8).fork(3);
  assert.equal(childA.next(), childB.next());
});

test('hashString and seedFrom are stable', () => {
  assert.equal(hashString('cellar'), hashString('cellar'));
  assert.notEqual(hashString('cellar'), hashString('kitchen'));
  assert.equal(seedFrom('story', 1, 1), seedFrom('story', 1, 1));
  assert.notEqual(seedFrom('story', 1, 1), seedFrom('story', 1, 2));
});

test('value noise is in [0, 1]', () => {
  for (let i = 0; i < 20; i += 1) {
    const n1 = valueNoise1(i * 0.37, 3);
    const n2 = valueNoise2(i * 0.2, i * 0.11, 9);
    const n3 = fbm2(i * 0.15, 0.4, 4, 1);
    assert.ok(n1 >= 0 && n1 <= 1, `valueNoise1 ${n1}`);
    assert.ok(n2 >= 0 && n2 <= 1, `valueNoise2 ${n2}`);
    assert.ok(n3 >= 0 && n3 <= 1, `fbm2 ${n3}`);
  }
});

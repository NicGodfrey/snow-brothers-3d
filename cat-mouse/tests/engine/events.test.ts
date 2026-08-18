import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventBus, EventQueue, createEventBus } from '../../src/engine/events';

test('emit delivers to on() subscribers and off() stops them', () => {
  const bus = createEventBus();
  const hits: number[] = [];
  const handler = (n: number) => hits.push(n);
  const unsub = bus.on<number>('n', handler);
  bus.emit('n', 1);
  bus.emit('n', 2);
  unsub();
  bus.emit('n', 3);
  bus.off('n', handler);
  assert.deepEqual(hits, [1, 2]);
  assert.equal(bus.listenerCount('n'), 0);
});

test('once fires a single time', () => {
  const bus = new EventBus();
  const hits: string[] = [];
  bus.once<string>('go', (v) => hits.push(v));
  bus.emit('go', 'a');
  bus.emit('go', 'b');
  assert.deepEqual(hits, ['a']);
});

test('handlers added during emit run on the next emit', () => {
  const bus = new EventBus();
  const hits: string[] = [];
  bus.on('t', () => {
    hits.push('first');
    bus.on('t', () => hits.push('late'));
  });
  bus.emit('t', undefined);
  assert.deepEqual(hits, ['first']);
  bus.emit('t', undefined);
  assert.deepEqual(hits, ['first', 'first', 'late']);
});

test('clear removes topics and drained counts emits', () => {
  const bus = new EventBus();
  bus.on('a', () => undefined);
  bus.on('b', () => undefined);
  assert.deepEqual(bus.topicNames(), ['a', 'b']);
  bus.emit('a', 1);
  bus.emit('missing', 1);
  assert.equal(bus.drained, 2);
  bus.clear('a');
  assert.deepEqual(bus.topicNames(), ['b']);
  bus.clear();
  assert.deepEqual(bus.topicNames(), []);
});

test('EventQueue buffers, peeks, drains and drops oldest past limit', () => {
  const bus = new EventBus();
  const queue = new EventQueue<number>(bus, 'n', 3);
  bus.emit('n', 1);
  bus.emit('n', 2);
  assert.deepEqual([...queue.peek()], [1, 2]);
  assert.equal(queue.length, 2);
  bus.emit('n', 3);
  bus.emit('n', 4);
  assert.deepEqual(queue.drain(), [2, 3, 4]);
  assert.deepEqual(queue.drain(), []);
  queue.dispose();
  bus.emit('n', 5);
  assert.equal(queue.length, 0);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SystemScheduler,
  World,
  defineComponent,
  entityIndex,
  generationOf,
  makeSystem,
  makeSystemContext,
} from '../../src/engine/ecs';
import { NULL_ENTITY } from '../../src/engine/types';
import { EventBus } from '../../src/engine/events';
import { Mulberry32 } from '../../src/engine/rng';
import { StepClock } from '../../src/engine/loop';

const Position = defineComponent('position', () => ({ x: 0, y: 0 }));
const Velocity = defineComponent('velocity', () => ({ x: 0, y: 0 }));
const Tag = defineComponent('tag', () => ({ name: '' }));

test('defineComponent merges defaults', () => {
  const p = Position.create({ x: 4 });
  assert.equal(p.x, 4);
  assert.equal(p.y, 0);
  assert.ok(Position.id > 0);
  assert.equal(Position.name, 'position');
});

test('create, add, get, require, has, remove', () => {
  const world = new World();
  const e = world.create();
  assert.equal(world.alive(e), true);
  assert.equal(world.alive(NULL_ENTITY), false);
  const pos = world.add(e, Position, { x: 2, y: 3 });
  assert.equal(pos.x, 2);
  assert.deepEqual(world.get(e, Position), { x: 2, y: 3 });
  assert.equal(world.require(e, Position).y, 3);
  assert.equal(world.has(e, Position), true);
  assert.equal(world.has(e, Velocity), false);
  world.remove(e, Position);
  assert.equal(world.get(e, Position), undefined);
  assert.throws(() => world.require(e, Position));
});

test('set writes a full value and add on a dead entity throws', () => {
  const world = new World();
  const e = world.create();
  world.set(e, Position, { x: 9, y: 8 });
  assert.deepEqual(world.get(e, Position), { x: 9, y: 8 });
  world.destroy(e);
  assert.throws(() => world.add(e, Position));
  assert.throws(() => world.set(e, Position, { x: 0, y: 0 }));
});

test('destroy recycles the index with a new generation', () => {
  const world = new World();
  const first = world.create();
  const index = entityIndex(first);
  const gen = generationOf(first);
  world.add(first, Position, { x: 1, y: 1 });
  world.destroy(first);
  assert.equal(world.alive(first), false);
  const second = world.create();
  assert.equal(entityIndex(second), index);
  assert.notEqual(generationOf(second), gen);
  assert.equal(world.alive(first), false);
  assert.equal(world.alive(second), true);
  assert.equal(world.get(first, Position), undefined);
});

test('query all / none / any and cache invalidation', () => {
  const world = new World();
  const a = world.create();
  const b = world.create();
  const c = world.create();
  world.add(a, Position);
  world.add(a, Velocity);
  world.add(b, Position);
  world.add(c, Velocity);
  world.add(c, Tag, { name: 'c' });

  assert.deepEqual([...world.query({ all: [Position, Velocity] })], [a]);
  const noneTag = world.query({ all: [Position], none: [Tag] });
  assert.ok(noneTag.includes(a) && noneTag.includes(b) && !noneTag.includes(c));
  const any = world.query({ any: [Tag, Velocity] });
  assert.ok(any.includes(a) && any.includes(c));

  const first = world.query({ all: [Position] });
  const again = world.query({ all: [Position] });
  assert.equal(first, again);
  world.add(c, Position);
  const after = world.query({ all: [Position] });
  assert.ok(after.includes(c));
  assert.notEqual(after, first);
});

test('each, countOf, entities, componentsOf, clear', () => {
  const world = new World();
  const e = world.create();
  world.add(e, Position, { x: 1, y: 2 });
  world.add(e, Tag, { name: 'hero' });
  let seen = 0;
  world.each(Position, (_entity, value) => {
    seen += 1;
    assert.equal(value.x, 1);
  });
  assert.equal(seen, 1);
  assert.equal(world.countOf(Position), 1);
  assert.deepEqual(world.entities(), [e]);
  assert.deepEqual(world.componentsOf(e), ['position', 'tag']);
  assert.equal(world.entityCount, 1);
  world.clear();
  assert.equal(world.entityCount, 0);
  assert.equal(world.countOf(Position), 0);
});

test('SystemScheduler runs in order and skips disabled systems', () => {
  const world = new World();
  const order: string[] = [];
  const scheduler = new SystemScheduler()
    .add(makeSystem('late', 20, () => order.push('late')))
    .add(makeSystem('early', 5, () => order.push('early')))
    .add(makeSystem('off', 1, () => order.push('off'), false));
  assert.equal(scheduler.has('late'), true);
  assert.deepEqual(scheduler.names(), ['off', 'early', 'late']);
  const ctx = makeSystemContext({
    world,
    step: 1 / 60,
    clock: new StepClock(),
    rng: new Mulberry32(1),
    events: new EventBus(),
  });
  scheduler.run(ctx);
  assert.deepEqual(order, ['early', 'late']);
  assert.equal(scheduler.remove('late'), true);
  assert.equal(scheduler.size, 2);
  assert.equal(scheduler.remove('missing'), false);
});

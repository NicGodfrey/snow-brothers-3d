import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allCheeseTaken,
  createCheese,
  dropCarriedCheese,
  guardBlocksPickup,
  remainingCheeseValue,
  tryPickupCheese,
} from '../../src/game/cheese';
import { makeTestMouse } from '../helpers/actors';
import { EventBus } from '../../src/engine/events';

test('pickup takes cheese until capacity and skips guarded cheese', () => {
  const mouse = makeTestMouse(1, 1);
  mouse.carryCapacity = 1;
  const cheeses = [createCheese(2, 1, 1, 1, false), createCheese(3, 1.2, 1, 1, false)];
  const bus = new EventBus();
  const taken: number[] = [];
  bus.on('cheese:taken', (p: { value: number }) => taken.push(p.value));
  assert.ok(tryPickupCheese(mouse, cheeses, bus));
  assert.equal(mouse.carrying, 1);
  assert.equal(tryPickupCheese(mouse, cheeses, bus), null);
  assert.deepEqual(taken, [1]);
  const guarded = createCheese(4, 8, 8, 1, true);
  assert.equal(guardBlocksPickup(guarded, [{ transform: { x: 8, y: 8 } }]), true);
  assert.equal(remainingCheeseValue(cheeses), 1);
  assert.equal(allCheeseTaken(cheeses), false);
});

test('dropCarriedCheese returns the load to the floor', () => {
  const mouse = makeTestMouse(2, 2);
  mouse.carrying = 2;
  const cheeses: ReturnType<typeof createCheese>[] = [];
  const dropped = dropCarriedCheese(mouse, cheeses, () => 9);
  assert.ok(dropped);
  assert.equal(mouse.carrying, 0);
  assert.equal(dropped.value, 2);
  assert.equal(dropped.taken, false);
});

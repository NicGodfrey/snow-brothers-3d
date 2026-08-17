import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STEP, FixedLoop, FrameTimer, StepClock } from '../../src/engine/loop';
import type { Clock } from '../../src/engine/types';

test('advance runs a fixed number of steps and interpolates alpha', () => {
  const ticks: number[] = [];
  let renders = 0;
  const loop = new FixedLoop(
    {
      fixedUpdate(_step: number, clock: Clock) {
        ticks.push(clock.tick);
      },
      render() {
        renders += 1;
      },
    },
    { step: 0.1, maxStepsPerFrame: 8 },
  );
  const steps = loop.advance(0.25);
  assert.equal(steps, 2);
  assert.equal(ticks.length, 2);
  assert.equal(renders, 1);
  const clock = loop.clockView();
  assert.ok(clock.alpha > 0 && clock.alpha < 1);
  assert.equal(clock.elapsed, 0.2);
});

test('spiral-of-death guard drops leftover time', () => {
  let updates = 0;
  const loop = new FixedLoop(
    {
      fixedUpdate() {
        updates += 1;
      },
      render() {},
    },
    { step: 0.05, maxStepsPerFrame: 3 },
  );
  loop.advance(1);
  assert.equal(updates, 3);
  assert.equal(loop.dropped, 1);
});

test('time scale 0 freezes simulation but still renders', () => {
  let updates = 0;
  let renders = 0;
  const loop = new FixedLoop(
    {
      fixedUpdate() {
        updates += 1;
      },
      render() {
        renders += 1;
      },
    },
    { step: DEFAULT_STEP },
  );
  loop.setTimeScale(0);
  loop.advance(1);
  assert.equal(updates, 0);
  assert.equal(renders, 1);
});

test('start and stop are idempotent with a fake scheduler', () => {
  let scheduled = 0;
  let cancelled = 0;
  const loop = new FixedLoop(
    { fixedUpdate() {}, render() {} },
    {
      now: () => 1,
      schedule: () => {
        scheduled += 1;
        return 7;
      },
      cancel: () => {
        cancelled += 1;
      },
    },
  );
  loop.start();
  assert.equal(loop.isRunning, true);
  assert.equal(scheduled, 1);
  loop.start();
  assert.equal(scheduled, 1);
  loop.stop();
  assert.equal(loop.isRunning, false);
  assert.equal(cancelled, 1);
  loop.stop();
  assert.equal(cancelled, 1);
});

test('StepClock and FrameTimer', () => {
  const clock = new StepClock(0.5);
  clock.advance();
  clock.advance();
  assert.equal(clock.tick, 2);
  assert.equal(clock.elapsed, 1);
  clock.reset();
  assert.equal(clock.tick, 0);
  assert.equal(clock.elapsed, 0);

  const timer = new FrameTimer(3);
  timer.push(0.1);
  timer.push(0.3);
  timer.push(0.2);
  timer.push(0.4);
  assert.equal(timer.history().length, 3);
  assert.equal(timer.worst, 0.4);
  assert.ok(Math.abs(timer.average - (0.3 + 0.2 + 0.4) / 3) < 1e-12);
  timer.clear();
  assert.equal(timer.average, 0);
});

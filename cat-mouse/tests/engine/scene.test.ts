import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SceneStack, makeScene } from '../../src/engine/scene';
import { StepClock } from '../../src/engine/loop';
import { FrozenInput } from '../../src/engine/input';
import { HeadlessRenderer } from '../../src/engine/renderer';
import { makeAudio } from '../../src/engine/audio';
import { createEventBus } from '../../src/engine/events';
import { makeRng } from '../../src/engine/rng';
import type { SceneContext } from '../../src/engine/types';

function ctx(): SceneContext {
  return {
    clock: new StepClock(),
    input: new FrozenInput(0),
    renderer: new HeadlessRenderer(),
    audio: makeAudio(),
    events: createEventBus(),
    rng: makeRng(1),
    width: 1280,
    height: 720,
  };
}

test('SceneStack push pauses the previous scene and pop resumes it', () => {
  const log: string[] = [];
  const a = makeScene('title', {
    enter: () => log.push('a-enter'),
    pause: () => log.push('a-pause'),
    resume: () => log.push('a-resume'),
    exit: () => log.push('a-exit'),
    update: () => log.push('a-update'),
    render: () => log.push('a-render'),
  });
  const b = makeScene('play', {
    enter: () => log.push('b-enter'),
    exit: () => log.push('b-exit'),
    update: () => log.push('b-update'),
    render: () => log.push('b-render'),
  });
  const stack = new SceneStack();
  const c = ctx();
  stack.push(a, c);
  stack.update(c, 1 / 60);
  stack.push(b, c);
  stack.update(c, 1 / 60);
  stack.pop(c);
  assert.deepEqual(stack.names(), ['title']);
  assert.ok(log.includes('a-pause'));
  assert.ok(log.includes('b-enter'));
  assert.ok(log.includes('a-resume'));
  assert.equal(stack.size, 1);
});

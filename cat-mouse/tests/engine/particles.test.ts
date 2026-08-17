import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ParticleSystem } from '../../src/engine/particles';

test('ParticleSystem emit, update and pool cap', () => {
  const particles = new ParticleSystem(4);
  const spawned = particles.burst({ count: 8, x: 0, y: 0, color: '#fff', life: 0.2, speed: 10 });
  assert.equal(spawned, 4);
  assert.equal(particles.count, 4);
  particles.update(1);
  assert.equal(particles.count, 0);
});

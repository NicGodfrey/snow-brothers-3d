import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FogMap, HeadlessRenderer, parseCssColor } from '../../src/engine/renderer';
import { makeCamera } from '../../src/engine/camera';

test('parseCssColor reads hex and rgba', () => {
  assert.deepEqual(parseCssColor('#ff0000'), { r: 255, g: 0, b: 0, a: 1 });
  const rgba = parseCssColor('rgba(1, 2, 3, 0.5)');
  assert.equal(rgba.r, 1);
  assert.equal(rgba.g, 2);
  assert.equal(rgba.b, 3);
  assert.equal(rgba.a, 0.5);
});

test('HeadlessRenderer records sprites and lights', () => {
  const renderer = new HeadlessRenderer();
  const cam = makeCamera(64, 64);
  renderer.begin(cam);
  renderer.clear('#000');
  renderer.sprite({ x: 1, y: 2, w: 8, h: 8, color: '#fff' });
  renderer.light({ x: 4, y: 4, radius: 10, color: '#ff0', intensity: 1 });
  renderer.text('hi', 0, 0, '#fff');
  renderer.end();
  assert.equal(renderer.cleared, '#000');
  assert.equal(renderer.sprites.length, 1);
  assert.equal(renderer.lights.length, 1);
  assert.equal(renderer.texts[0]?.text, 'hi');
});

test('FogMap reveal marks explored cells', () => {
  const fog = new FogMap(8, 8);
  fog.reveal(2, 2, 2, 1);
  assert.equal(fog.isVisible(2, 2), true);
  assert.equal(fog.isExplored(2, 2), true);
});

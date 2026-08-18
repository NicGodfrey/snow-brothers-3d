import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DebugOverlay, PerfMark, formatBytes } from '../../src/engine/debug';
import { HeadlessRenderer } from '../../src/engine/renderer';
import { makeCamera } from '../../src/engine/camera';

test('debug overlay watches and toggle', () => {
  const debug = new DebugOverlay();
  debug.watch('fps', 60);
  debug.log('hello');
  debug.toggle();
  assert.equal(debug.enabled, true);
  const renderer = new HeadlessRenderer();
  renderer.begin(makeCamera(200, 100));
  debug.draw?.(renderer as never);
  debug.unwatch('fps');
  assert.equal(formatBytes(500), '500 B');
  assert.match(formatBytes(2048), /KB/);
});

test('PerfMark records elapsed time', () => {
  const mark = new PerfMark(4);
  let t = 0;
  const elapsed = mark.measure(
    () => undefined,
    () => {
      t += 5;
      return t;
    },
  );
  assert.equal(elapsed, 5);
  assert.equal(mark.average, 5);
});

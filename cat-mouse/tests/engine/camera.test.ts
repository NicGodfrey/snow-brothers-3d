import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FollowCamera, makeCamera } from '../../src/engine/camera';

test('makeCamera snaps and converts world/screen', () => {
  const cam = makeCamera(320, 180, 2);
  cam.snapTo(50, 40);
  assert.equal(cam.x, 50);
  assert.equal(cam.y, 40);
  const screen = cam.worldToScreen(50, 40);
  assert.equal(screen.x, 160);
  assert.equal(screen.y, 90);
  const world = cam.screenToWorld(160, 90);
  assert.ok(Math.abs(world.x - 50) < 1e-6);
  assert.ok(Math.abs(world.y - 40) < 1e-6);
});

test('follow and shake stay bounded', () => {
  const cam = new FollowCamera({ viewportWidth: 200, viewportHeight: 100, stiffness: 20 });
  cam.snapTo(0, 0);
  cam.follow(40, 0, 10, 0);
  cam.update(0.25);
  assert.ok(cam.x > 0);
  cam.addShake(2);
  assert.ok(cam.shake <= 1);
  cam.setBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
  cam.snapTo(1000, 1000);
  assert.ok(cam.x <= 100);
});

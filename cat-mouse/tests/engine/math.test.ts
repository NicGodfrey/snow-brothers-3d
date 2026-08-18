import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EPSILON,
  TAU,
  angleDelta,
  approach,
  averageOf,
  bresenham,
  chebyshev,
  circleIntersects,
  circleRectIntersects,
  clamp,
  clamp01,
  damp,
  directionOf4,
  directionOf8,
  distance,
  distanceSq,
  easeInOutCubic,
  easeInQuad,
  easeOutQuad,
  inCone,
  inverseLerp,
  lerp,
  manhattan,
  maxOf,
  minOf,
  moveTowards,
  octile,
  pointInCircle,
  rect,
  rectCenter,
  rectContains,
  rectExpand,
  rectIntersects,
  rectOverlap,
  remap,
  rotateToward,
  roundTo,
  sign,
  smoothStep,
  smootherStep,
  sumOf,
  vAdd,
  vAngle,
  vCross,
  vDot,
  vFromAngle,
  vLength,
  vLengthSq,
  vLerp,
  vLimit,
  vNormalize,
  vRotate,
  vScale,
  vSub,
  vec2,
  wrap,
  wrapAngle,
} from '../../src/engine/math';

const close = (actual: number, expected: number, eps = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `expected ${expected} ± ${eps}, got ${actual}`,
  );
};

test('clamp and clamp01', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-2, 0, 3), 0);
  assert.equal(clamp(1, 0, 3), 1);
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(1.2), 1);
  assert.equal(clamp01(0.4), 0.4);
});

test('lerp, inverseLerp, remap', () => {
  assert.equal(lerp(0, 10, 0.5), 5);
  assert.equal(lerp(2, 4, 0), 2);
  assert.equal(lerp(2, 4, 1), 4);
  close(inverseLerp(0, 10, 5), 0.5);
  assert.equal(inverseLerp(3, 3, 9), 0);
  close(remap(5, 0, 10, 0, 100), 50);
});

test('approach, damp, sign', () => {
  assert.equal(approach(0, 10, 3), 3);
  assert.equal(approach(8, 10, 3), 10);
  assert.equal(approach(10, 4, 3), 7);
  assert.equal(approach(4, 4, 1), 4);
  const damped = damp(0, 10, 4, 0.25);
  assert.ok(damped > 0 && damped < 10);
  assert.equal(sign(-4), -1);
  assert.equal(sign(0), 0);
  assert.equal(sign(9), 1);
});

test('wrap and angles', () => {
  close(wrap(12, 0, 10), 2);
  close(wrap(-1, 0, 10), 9);
  assert.equal(wrap(3, 5, 5), 5);
  close(wrapAngle(Math.PI + 0.2), -Math.PI + 0.2, 1e-6);
  close(angleDelta(0, 0.2), 0.2);
  close(Math.abs(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)), 0.2, 1e-6);
  close(rotateToward(0, 1, 0.25), 0.25);
  close(rotateToward(0, 0.1, 0.5), 0.1);
});

test('easing stays in range for unit input', () => {
  close(smoothStep(0), 0);
  close(smoothStep(1), 1);
  assert.ok(smoothStep(0.5) > 0.4);
  close(smootherStep(0), 0);
  close(smootherStep(1), 1);
  close(easeInQuad(0.5), 0.25);
  close(easeOutQuad(0), 0);
  close(easeOutQuad(1), 1);
  close(easeInOutCubic(0), 0);
  close(easeInOutCubic(1), 1);
  close(easeInOutCubic(0.5), 0.5);
});

test('vec2 arithmetic', () => {
  assert.deepEqual(vec2(1, 2), { x: 1, y: 2 });
  assert.deepEqual(vAdd({ x: 1, y: 2 }, { x: 3, y: 4 }), { x: 4, y: 6 });
  assert.deepEqual(vSub({ x: 3, y: 4 }, { x: 1, y: 2 }), { x: 2, y: 2 });
  assert.deepEqual(vScale({ x: 2, y: -1 }, 3), { x: 6, y: -3 });
  assert.equal(vDot({ x: 1, y: 2 }, { x: 3, y: 4 }), 11);
  assert.equal(vCross({ x: 1, y: 0 }, { x: 0, y: 1 }), 1);
  assert.equal(vLengthSq({ x: 3, y: 4 }), 25);
  close(vLength({ x: 3, y: 4 }), 5);
  const n = vNormalize({ x: 0, y: 4 });
  close(n.x, 0);
  close(n.y, 1);
  assert.deepEqual(vNormalize({ x: 0, y: 0 }), { x: 0, y: 0 });
  const limited = vLimit({ x: 6, y: 8 }, 5);
  close(vLength(limited), 5);
  const mid = vLerp({ x: 0, y: 0 }, { x: 10, y: 0 }, 0.25);
  close(mid.x, 2.5);
  const rotated = vRotate({ x: 1, y: 0 }, Math.PI / 2);
  close(rotated.x, 0, 1e-9);
  close(rotated.y, 1, 1e-9);
  const from = vFromAngle(0, 2);
  close(from.x, 2);
  close(from.y, 0);
  close(vAngle({ x: 0, y: 1 }), Math.PI / 2);
});

test('distance metrics', () => {
  close(distance(0, 0, 3, 4), 5);
  assert.equal(distanceSq(0, 0, 3, 4), 25);
  assert.equal(manhattan(0, 0, 3, 4), 7);
  assert.equal(chebyshev(0, 0, 3, 4), 4);
  close(octile(0, 0, 3, 4), 3 + 4 + (Math.SQRT2 - 2) * 3);
});

test('rect and circle queries', () => {
  const a = rect(0, 0, 10, 10);
  const b = rect(8, 8, 10, 10);
  assert.equal(rectContains(a, 0, 0), true);
  assert.equal(rectContains(a, 10, 10), false);
  assert.equal(rectIntersects(a, b), true);
  assert.equal(rectIntersects(a, rect(20, 20, 1, 1)), false);
  assert.deepEqual(rectOverlap(a, b), { x: 8, y: 8, w: 2, h: 2 });
  assert.equal(rectOverlap(a, rect(20, 0, 1, 1)), null);
  assert.deepEqual(rectCenter(a), { x: 5, y: 5 });
  assert.deepEqual(rectExpand(a, 2), { x: -2, y: -2, w: 14, h: 14 });
  assert.equal(circleIntersects({ x: 0, y: 0, r: 2 }, { x: 3, y: 0, r: 1 }), true);
  assert.equal(circleIntersects({ x: 0, y: 0, r: 1 }, { x: 3, y: 0, r: 1 }), false);
  assert.equal(circleRectIntersects({ x: 12, y: 5, r: 3 }, a), true);
  assert.equal(pointInCircle(1, 0, { x: 0, y: 0, r: 1 }), true);
});

test('inCone uses facing and half-angle', () => {
  assert.equal(inCone(0, 0, 0, Math.PI / 4, 10, 5, 0), true);
  assert.equal(inCone(0, 0, 0, Math.PI / 8, 10, 0, 5), false);
  assert.equal(inCone(0, 0, 0, Math.PI / 4, 2, 5, 0), false);
  assert.equal(inCone(0, 0, 0, Math.PI / 4, 10, 0, 0), true);
});

test('cardinal and octant directions', () => {
  assert.equal(directionOf4(2, 1), 'east');
  assert.equal(directionOf4(-2, 1), 'west');
  assert.equal(directionOf4(1, 3), 'south');
  assert.equal(directionOf4(1, -3), 'north');
  assert.equal(directionOf8(1, 0), 'east');
  assert.equal(directionOf8(0, 1), 'south');
  assert.equal(directionOf8(-1, 0), 'west');
  assert.equal(directionOf8(0, -1), 'north');
});

test('moveTowards and bresenham', () => {
  const stepped = moveTowards({ x: 0, y: 0 }, { x: 10, y: 0 }, 3);
  close(stepped.x, 3);
  close(stepped.y, 0);
  const arrived = moveTowards({ x: 0, y: 0 }, { x: 1, y: 0 }, 4);
  assert.deepEqual(arrived, { x: 1, y: 0 });
  assert.deepEqual(bresenham(0, 0, 3, 0), [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 3, y: 0 },
  ]);
  const diag = bresenham(0, 0, 2, 2);
  assert.equal(diag[0]?.x, 0);
  assert.equal(diag[diag.length - 1]?.x, 2);
  assert.equal(diag[diag.length - 1]?.y, 2);
});

test('reductions and roundTo', () => {
  assert.equal(sumOf([1, 2, 3]), 6);
  assert.equal(averageOf([2, 4, 6]), 4);
  assert.equal(averageOf([]), 0);
  assert.equal(maxOf([1, 9, 3]), 9);
  assert.equal(minOf([1, 9, 3]), 1);
  assert.equal(roundTo(1.2345, 2), 1.23);
  assert.ok(TAU > 6.28 && TAU < 6.29);
  assert.ok(EPSILON < 1e-5);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { computeStatistics } from "../src/domain/statistics.js";

test("mean, min, max, range and sample stdDev", () => {
  const stats = computeStatistics([2, 4, 4, 4, 5, 5, 7, 9]);
  assert.equal(stats.count, 8);
  assert.equal(stats.mean, 5);
  assert.equal(stats.min, 2);
  assert.equal(stats.max, 9);
  assert.equal(stats.range, 7);
  // sample variance = 32/7
  assert.equal(stats.stdDev, Math.round(Math.sqrt(32 / 7) * 10_000) / 10_000);
});

test("single reading has null stdDev/cp/cpk", () => {
  const stats = computeStatistics([10]);
  assert.equal(stats.stdDev, null);
  assert.equal(stats.cp, null);
  assert.equal(stats.cpk, null);
});

test("cp and cpk with two-sided limits", () => {
  // Centered process: readings symmetric around 10, limits 9.9/10.1
  const stats = computeStatistics([9.98, 10.02, 9.99, 10.01, 10.0], 9.9, 10.1);
  assert.ok(stats.cp !== null && stats.cp > 1);
  assert.ok(stats.cpk !== null && stats.cpk > 1);
  // Centered => cpk close to cp
  assert.ok(Math.abs(stats.cp! - stats.cpk!) < 0.2);
});

test("cpk uses the nearer limit for off-center processes", () => {
  const centered = computeStatistics([10.0, 10.01, 9.99, 10.0], 9.9, 10.1);
  const offCenter = computeStatistics([10.07, 10.08, 10.06, 10.07], 9.9, 10.1);
  assert.ok(offCenter.cpk! < centered.cpk!);
});

test("one-sided limit yields cpk but not cp", () => {
  const stats = computeStatistics([5, 6, 7], undefined, 10);
  assert.equal(stats.cp, null);
  assert.ok(stats.cpk !== null);
});

test("out-of-spec counting", () => {
  const stats = computeStatistics([9.5, 10.0, 10.2, 10.05], 9.9, 10.1);
  assert.equal(stats.outOfSpecCount, 2);
});

test("zero readings throws", () => {
  assert.throws(() => computeStatistics([]));
});

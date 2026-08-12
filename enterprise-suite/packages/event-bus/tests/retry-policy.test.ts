import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  baseDelayMs,
  DEFAULT_RETRY_POLICY,
  maxTotalDelayMs,
  NETWORK_RETRY_POLICY,
  nextDelayMs,
  NO_RETRY_POLICY,
  retryPolicy,
  RetryPolicyError,
  retrySchedule,
  shouldRetry,
  validateRetryPolicy,
} from "../src/retry-policy.js";

describe("retry policy", () => {
  it("grows exponentially and caps at maxDelayMs", () => {
    const policy = retryPolicy({ maxAttempts: 6, initialDelayMs: 100, multiplier: 3, maxDelayMs: 1_000 });
    assert.deepEqual(retrySchedule(policy), [100, 300, 900, 1_000, 1_000]);
    assert.equal(baseDelayMs(policy, 1), 100);
    assert.equal(maxTotalDelayMs(policy), 3_300);
  });

  it("emits maxAttempts - 1 delays", () => {
    assert.equal(retrySchedule(DEFAULT_RETRY_POLICY).length, DEFAULT_RETRY_POLICY.maxAttempts - 1);
    assert.deepEqual(retrySchedule(NO_RETRY_POLICY), []);
    assert.equal(shouldRetry(NO_RETRY_POLICY, 1), false);
    assert.equal(shouldRetry(DEFAULT_RETRY_POLICY, 1), true);
    assert.equal(shouldRetry(DEFAULT_RETRY_POLICY, 3), false);
  });

  it("applies full jitter within [0, base]", () => {
    const policy = retryPolicy({ initialDelayMs: 1_000, jitter: "full" });
    assert.equal(nextDelayMs(policy, 1, () => 0), 0);
    assert.equal(nextDelayMs(policy, 1, () => 1), 1_000);
    assert.equal(nextDelayMs(policy, 1, () => 0.25), 250);
  });

  it("applies equal jitter within [base/2, base]", () => {
    const policy = retryPolicy({ initialDelayMs: 1_000, jitter: "equal" });
    assert.equal(nextDelayMs(policy, 1, () => 0), 500);
    assert.equal(nextDelayMs(policy, 1, () => 1), 1_000);
    assert.equal(nextDelayMs(policy, 1, () => 0.5), 750);
  });

  it("keeps the network policy inside a ten minute ceiling", () => {
    const schedule = retrySchedule(NETWORK_RETRY_POLICY);
    assert.deepEqual(schedule.slice(0, 4), [1_000, 5_000, 25_000, 125_000]);
    assert.ok(schedule.every((delay) => delay <= NETWORK_RETRY_POLICY.maxDelayMs));
  });

  it("rejects nonsensical policies", () => {
    assert.throws(() => validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, maxAttempts: 0 }), RetryPolicyError);
    assert.throws(() => validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, multiplier: 0.5 }), RetryPolicyError);
    assert.throws(
      () => validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, initialDelayMs: 10, maxDelayMs: 5 }),
      RetryPolicyError,
    );
    assert.throws(
      () => validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, jitter: "wild" as never }),
      RetryPolicyError,
    );
  });
});

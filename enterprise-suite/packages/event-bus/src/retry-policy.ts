/**
 * Retry policies shared by the bus, the outbox relay and webhook delivery.
 *
 * Delays follow capped exponential backoff:
 *   delay(attempt) = min(maxDelayMs, initialDelayMs * multiplier^(attempt-1))
 * where `attempt` is the 1-based number of the attempt that just failed.
 * Jitter spreads retries so a fleet of workers does not re-hit a recovering
 * endpoint in lockstep.
 */

export type JitterMode = "none" | "full" | "equal";

export interface RetryPolicy {
  /** Total attempts including the first one. `1` means "never retry". */
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly multiplier: number;
  readonly jitter: JitterMode;
}

export class RetryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryPolicyError";
  }
}

/** Fast, low-attempt policy for in-process handlers. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 50,
  maxDelayMs: 5_000,
  multiplier: 2,
  jitter: "none",
};

/** Patient policy for network delivery (~ 1s, 5s, 25s, 125s, 600s, 600s...). */
export const NETWORK_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 8,
  initialDelayMs: 1_000,
  maxDelayMs: 600_000,
  multiplier: 5,
  jitter: "equal",
};

export const NO_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 1,
  initialDelayMs: 0,
  maxDelayMs: 0,
  multiplier: 1,
  jitter: "none",
};

export function retryPolicy(overrides: Partial<RetryPolicy> = {}): RetryPolicy {
  return validateRetryPolicy({ ...DEFAULT_RETRY_POLICY, ...overrides });
}

export function validateRetryPolicy(policy: RetryPolicy): RetryPolicy {
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RetryPolicyError("maxAttempts must be an integer >= 1");
  }
  if (policy.maxAttempts > 100) {
    throw new RetryPolicyError("maxAttempts must be <= 100");
  }
  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 0) {
    throw new RetryPolicyError("initialDelayMs must be a non-negative number");
  }
  if (!Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs) {
    throw new RetryPolicyError("maxDelayMs must be >= initialDelayMs");
  }
  if (!Number.isFinite(policy.multiplier) || policy.multiplier < 1) {
    throw new RetryPolicyError("multiplier must be >= 1");
  }
  if (!["none", "full", "equal"].includes(policy.jitter)) {
    throw new RetryPolicyError(`unknown jitter mode '${policy.jitter}'`);
  }
  return policy;
}

export function shouldRetry(policy: RetryPolicy, attempt: number): boolean {
  return attempt < policy.maxAttempts;
}

/** Deterministic backoff before jitter, for the retry after `attempt`. */
export function baseDelayMs(policy: RetryPolicy, attempt: number): number {
  const exponent = Math.max(0, attempt - 1);
  const raw = policy.initialDelayMs * Math.pow(policy.multiplier, exponent);
  return Math.round(Math.min(policy.maxDelayMs, raw));
}

/**
 * Delay before the retry that follows a failed `attempt`.
 * `rand` is injectable so tests stay deterministic.
 */
export function nextDelayMs(
  policy: RetryPolicy,
  attempt: number,
  rand: () => number = Math.random,
): number {
  const base = baseDelayMs(policy, attempt);
  switch (policy.jitter) {
    case "none":
      return base;
    case "full":
      return Math.round(base * rand());
    case "equal":
      return Math.round(base / 2 + (base / 2) * rand());
  }
}

/** The full deterministic delay ladder, useful for docs and assertions. */
export function retrySchedule(policy: RetryPolicy): number[] {
  const delays: number[] = [];
  for (let attempt = 1; attempt < policy.maxAttempts; attempt++) {
    delays.push(baseDelayMs(policy, attempt));
  }
  return delays;
}

/** Worst-case total time spent retrying, ignoring handler duration. */
export function maxTotalDelayMs(policy: RetryPolicy): number {
  return retrySchedule(policy).reduce((sum, delay) => sum + delay, 0);
}

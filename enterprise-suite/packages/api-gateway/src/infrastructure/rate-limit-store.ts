import type { RateLimitDecision } from "../domain/policy.js";
import type { RateLimitStore } from "../application/ports.js";

interface Window {
  count: number;
  startedAtMs: number;
}

/**
 * Fixed-window counter. Cheap, predictable and good enough for a single
 * gateway process; a multi-replica deployment swaps this for Redis behind the
 * same port without touching the routing code.
 */
export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly windows = new Map<string, Window>();
  private lastSweepMs = 0;

  hit(key: string, limit: number, windowMs: number, nowMs: number): RateLimitDecision {
    this.sweep(nowMs, windowMs);
    const existing = this.windows.get(key);
    const window =
      existing && nowMs - existing.startedAtMs < windowMs
        ? existing
        : { count: 0, startedAtMs: nowMs };

    window.count += 1;
    this.windows.set(key, window);

    const resetAtMs = window.startedAtMs + windowMs;
    const allowed = window.count <= limit;
    return {
      allowed,
      limit,
      remaining: Math.max(0, limit - window.count),
      resetAtMs,
      retryAfterMs: allowed ? 0 : Math.max(0, resetAtMs - nowMs),
    };
  }

  peek(key: string): Window | undefined {
    const window = this.windows.get(key);
    return window ? { ...window } : undefined;
  }

  reset(key?: string): void {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }

  get size(): number {
    return this.windows.size;
  }

  /** Drops expired windows occasionally so the map cannot grow unbounded. */
  private sweep(nowMs: number, windowMs: number): void {
    if (nowMs - this.lastSweepMs < Math.max(windowMs, 1_000)) return;
    this.lastSweepMs = nowMs;
    for (const [key, window] of this.windows) {
      if (nowMs - window.startedAtMs >= windowMs * 2) this.windows.delete(key);
    }
  }
}

/** Never throttles; used when a deployment disables rate limiting entirely. */
export class NoopRateLimitStore implements RateLimitStore {
  hit(_key: string, limit: number, windowMs: number, nowMs: number): RateLimitDecision {
    return {
      allowed: true,
      limit,
      remaining: limit,
      resetAtMs: nowMs + windowMs,
      retryAfterMs: 0,
    };
  }

  reset(): void {
    /* nothing to reset */
  }
}

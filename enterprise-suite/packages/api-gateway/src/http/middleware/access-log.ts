import type { Clock, Logger, MetricsSink } from "../../application/ports.js";
import type { Middleware } from "../router.js";

/**
 * Structured access logging plus request metrics. Slow requests and 5xx are
 * logged at warn/error so a noisy tenant is visible without turning on debug.
 */
export function accessLog(options: {
  logger: Logger;
  clock: Clock;
  metrics?: MetricsSink;
  slowRequestMs?: number;
  skipPaths?: readonly string[];
}): Middleware {
  const slowMs = options.slowRequestMs ?? 1_000;
  const skip = new Set(options.skipPaths ?? ["/health", "/health/live"]);

  return async (req, next) => {
    const startedMs = options.clock.nowMs();
    let status = 500;
    try {
      const response = await next();
      status = response.status;
      return response;
    } finally {
      const durationMs = options.clock.nowMs() - startedMs;
      const routeId = req.locals["routeName"] as string | undefined;
      options.metrics?.record({
        method: req.method,
        path: req.path,
        routeId,
        status,
        durationMs,
        tenantId: String(req.ctx.tenantId),
        upstream: req.locals["upstream"] as string | undefined,
      });
      if (!skip.has(req.path)) {
        const level = status >= 500 ? "error" : status >= 400 || durationMs > slowMs ? "warn" : "info";
        options.logger.log(level, `${req.method} ${req.path} ${status}`, {
          durationMs,
          routeId,
          tenantId: String(req.ctx.tenantId),
          userId: String(req.ctx.userId),
          requestId: String(req.ctx.requestId),
        });
      }
    }
  };
}

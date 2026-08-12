import type { Clock, RateLimitStore } from "../../application/ports.js";
import { rateLimitHeaders, type RateLimitDecision } from "../../domain/policy.js";
import type { RateLimitKeyStrategy } from "../../domain/route.js";
import type { HttpRequest, Middleware } from "../router.js";

/**
 * Route-independent throttling for services that embed the kernel. The gateway
 * itself throttles per route definition inside `GatewayService`; this
 * middleware covers everything else with one policy per bucket strategy.
 */
export function rateLimit(options: {
  store: RateLimitStore;
  clock: Clock;
  limit: number;
  windowMs: number;
  key?: RateLimitKeyStrategy;
  skipPaths?: readonly string[];
  keyFor?: (req: HttpRequest) => string;
}): Middleware {
  const skip = new Set(options.skipPaths ?? ["/health", "/health/live", "/health/ready"]);
  const strategy = options.key ?? "tenant";

  return async (req, next) => {
    if (skip.has(req.path)) return next();

    const key = options.keyFor?.(req) ?? defaultKey(strategy, req);
    const decision: RateLimitDecision = options.store.hit(
      key,
      options.limit,
      options.windowMs,
      options.clock.nowMs(),
    );
    const headers = rateLimitHeaders(decision);

    if (!decision.allowed) {
      return {
        status: 429,
        headers,
        body: {
          code: "RATE_LIMITED",
          message: `Rate limit of ${options.limit} requests per ${options.windowMs}ms exceeded`,
          requestId: String(req.ctx.requestId),
          details: { resetAtMs: decision.resetAtMs },
        },
      };
    }

    const response = await next();
    return { ...response, headers: { ...(response.headers ?? {}), ...headers } };
  };
}

function defaultKey(strategy: RateLimitKeyStrategy, req: HttpRequest): string {
  const tenant = String(req.ctx.tenantId);
  switch (strategy) {
    case "global":
      return "global";
    case "tenant":
      return `tenant:${tenant}`;
    case "tenant-user":
      return `tenant-user:${tenant}:${String(req.ctx.userId)}`;
    case "tenant-route":
      return `tenant-route:${tenant}:${(req.locals["routeName"] as string) ?? req.path}`;
    default: {
      const exhaustive: never = strategy;
      return exhaustive;
    }
  }
}

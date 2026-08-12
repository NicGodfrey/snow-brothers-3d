import { createServer, type Server } from "node:http";
import type { ForwardDecision } from "../application/gateway-service.js";
import type { GatewayContainer } from "../infrastructure/container.js";
import { InMemoryMetrics } from "../infrastructure/logger.js";
import { accessLog } from "./middleware/access-log.js";
import { cors } from "./middleware/cors.js";
import { errorHandler } from "./middleware/error-handler.js";
import { tenantContextMiddleware } from "./middleware/tenant-context.js";
import { json, text, Router, type HttpRequest, type HttpResponse } from "./router.js";

/**
 * The gateway process: operational endpoints plus a catch-all proxy.
 *
 * Operational surface
 *   GET /health              liveness, never touches the network
 *   GET /health/ready        readiness fan-out (503 when a critical upstream is down)
 *   GET /openapi.json        aggregated OpenAPI document
 *   GET /openapi/report      aggregation diagnostics (sources, stubs, renames)
 *   GET /__gateway/routes    the route table as served
 *   GET /__gateway/services  the upstream catalog
 *   GET /__gateway/metrics   in-process request metrics
 *   *   /api/*               resolved against the route table and forwarded
 */

export interface GatewayServerOptions {
  /** Performs the upstream call for a forward decision. Defaults to `fetch`. */
  readonly forwarder?: (decision: ForwardDecision, req: HttpRequest) => Promise<HttpResponse>;
  readonly corsOrigins?: readonly string[];
  readonly exposeRoutes?: boolean;
  /** Shared HS256 token secret. Required to accept bearer/cookie authentication. */
  readonly authSecret?: string;
  /** Development-only fallback for direct service headers. Defaults to false. */
  readonly trustHeaders?: boolean;
}

export function buildGatewayRouter(
  container: GatewayContainer,
  options: GatewayServerOptions = {},
): Router {
  const router = new Router({ serviceName: "api-gateway" });
  const forward = options.forwarder ?? fetchForwarder;

  router
    .use(errorHandler({ logger: container.logger, service: "api-gateway" }))
    .use(cors({ origins: options.corsOrigins }))
    .use(
      accessLog({
        logger: container.logger,
        clock: container.clock,
        metrics: container.metrics,
      }),
    )
    .use(
      tenantContextMiddleware({
        authSecret: options.authSecret,
        trustHeaders: options.trustHeaders,
        nowMs: () => container.clock.nowMs(),
        anonymousPaths: [
          "/health",
          "/health/*",
          "/ready",
          "/openapi.json",
          "/openapi/report",
          "/__gateway/*",
        ],
      }),
    );

  router.get("/health", () => json(200, container.health.live()), "health.live");
  router.get("/health/live", () => json(200, container.health.live()), "health.live");

  const readiness = async (req: HttpRequest): Promise<HttpResponse> => {
    const report = await container.health.ready({
      force: req.query.get("force") === "true",
      only: req.query.get("only")?.split(",").filter(Boolean),
      kind: req.query.get("kind") === "health" ? "health" : "ready",
    });
    return json(report.httpStatus, report);
  };
  router.get("/health/ready", readiness, "health.ready");
  router.get("/ready", readiness, "health.ready");

  router.get(
    "/openapi.json",
    async (req) => {
      const result = await container.openapi.aggregate({ force: req.query.get("force") === "true" });
      return json(200, result.document);
    },
    "openapi.document",
  );

  router.get(
    "/openapi/report",
    async (req) => {
      const result = await container.openapi.aggregate({ force: req.query.get("force") === "true" });
      return json(200, result.report);
    },
    "openapi.report",
  );

  if (options.exposeRoutes !== false) {
    router.get(
      "/__gateway/routes",
      (req) => {
        const upstream = req.query.get("upstream") ?? undefined;
        const tag = req.query.get("tag") ?? undefined;
        const routes = container.routes.describe({ upstream, tag });
        return json(200, {
          count: routes.length,
          findings: container.routes.audit(container.catalog.ids()),
          routes,
        });
      },
      "gateway.routes",
    );

    router.get(
      "/__gateway/services",
      () => json(200, { count: container.catalog.size, services: container.catalog.list() }),
      "gateway.services",
    );

    router.get(
      "/__gateway/metrics",
      () => {
        const metrics = container.metrics;
        if (metrics instanceof InMemoryMetrics) return json(200, metrics.snapshot());
        return json(200, { message: "metrics sink does not expose a snapshot" });
      },
      "gateway.metrics",
    );
  }

  router.get(
    "/",
    () =>
      json(200, {
        service: "api-gateway",
        routes: container.routes.size,
        upstreams: container.catalog.size,
        endpoints: [
          "/health",
          "/health/ready",
          "/openapi.json",
          "/openapi/report",
          "/__gateway/routes",
          "/__gateway/services",
        ],
      }),
    "gateway.index",
  );

  router.get("/robots.txt", () => text(200, "User-agent: *\nDisallow: /\n"), "gateway.robots");

  // Catch-all proxy: one entry per method keeps the matcher honest about 405s.
  const proxy = async (req: HttpRequest): Promise<HttpResponse> => {
    const decision = container.gateway.resolve({
      method: req.method,
      path: req.path,
      query: req.query.toString() || undefined,
      headers: req.headers,
      ctx: req.ctx,
      clientIp: req.clientIp,
    });
    if (decision.kind === "reject") {
      return {
        status: decision.status,
        headers: decision.headers,
        body: {
          code: decision.code,
          message: decision.message,
          details: decision.details,
          requestId: String(req.ctx.requestId),
        },
      };
    }
    req.locals["upstream"] = decision.service.id;
    req.locals["routeName"] = decision.route.id;
    const response = await forward(decision, req);
    return {
      ...response,
      headers: { ...decision.responseHeaders, ...(response.headers ?? {}) },
    };
  };

  for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"] as const) {
    router.add(method, "/api/*rest", proxy, "gateway.proxy");
  }

  return router;
}

/** Default forwarder: performs the upstream request with `fetch`. */
export async function fetchForwarder(
  decision: ForwardDecision,
  req: HttpRequest,
): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), decision.timeoutMs);
  try {
    const response = await fetch(decision.targetUrl, {
      method: req.method,
      headers: { ...decision.headers, accept: "application/json" },
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
    });
    const payload = await response.text();
    return {
      status: response.status,
      raw: payload,
      contentType: response.headers.get("content-type") ?? "application/json; charset=utf-8",
      headers: {
        "x-gateway-upstream": decision.service.id,
        "x-gateway-route": decision.route.id,
      },
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      status: aborted ? 504 : 502,
      body: {
        code: aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_UNAVAILABLE",
        message: aborted
          ? `${decision.service.id} did not respond within ${decision.timeoutMs}ms`
          : `${decision.service.id} could not be reached`,
        requestId: String(req.ctx.requestId),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export function createGatewayServer(
  container: GatewayContainer,
  options: GatewayServerOptions = {},
): Server {
  return createServer(buildGatewayRouter(container, options).listener());
}

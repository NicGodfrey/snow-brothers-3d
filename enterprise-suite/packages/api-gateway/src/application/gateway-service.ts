import type { TenantContext } from "@enterprise-suite/shared-kernel";
import {
  MethodNotAllowedError,
  RouteNotFoundError,
  UnknownUpstreamError,
} from "../domain/errors.js";
import {
  evaluateAuth,
  rateLimitHeaders,
  rateLimitKey,
  type PermissionResolver,
} from "../domain/policy.js";
import { resolveUpstreamPath, type HttpMethod, type RouteDefinition } from "../domain/route.js";
import type { RouteTable } from "../domain/route-table.js";
import type { ServiceCatalog, UpstreamService } from "../domain/service-catalog.js";
import type { Clock, RateLimitStore } from "./ports.js";

/**
 * Turns an inbound request into a forward-or-reject decision.
 *
 * The decision is data, not I/O: the HTTP layer (or a test) decides what to do
 * with it. That keeps routing, authorization and throttling verifiable without
 * sockets, and lets services embed the same rules in-process.
 */

export interface GatewayRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: string;
  readonly headers?: Readonly<Record<string, string | undefined>>;
  readonly ctx?: TenantContext;
  readonly clientIp?: string;
}

export interface ForwardDecision {
  readonly kind: "forward";
  readonly route: RouteDefinition;
  readonly service: UpstreamService;
  readonly targetUrl: string;
  /** Headers to send upstream. */
  readonly headers: Readonly<Record<string, string>>;
  /** Headers to echo back to the caller, e.g. remaining rate-limit quota. */
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly idempotent: boolean;
  readonly params: Readonly<Record<string, string>>;
}

export interface RejectDecision {
  readonly kind: "reject";
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly route?: RouteDefinition;
  readonly details?: unknown;
}

export type GatewayDecision = ForwardDecision | RejectDecision;

export interface GatewayOptions {
  readonly defaultTimeoutMs?: number;
  readonly permissions?: PermissionResolver;
  /** Applied to any route without its own policy. */
  readonly defaultRateLimit?: { limit: number; windowMs: number };
}

/** Headers that must not be forwarded verbatim to an upstream. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
]);

export class GatewayService {
  constructor(
    private readonly routes: RouteTable,
    private readonly catalog: ServiceCatalog,
    private readonly rateLimits: RateLimitStore,
    private readonly clock: Clock,
    private readonly options: GatewayOptions = {},
  ) {}

  get routeTable(): RouteTable {
    return this.routes;
  }

  get services(): ServiceCatalog {
    return this.catalog;
  }

  resolve(request: GatewayRequest): GatewayDecision {
    let match;
    try {
      match = this.routes.resolve(request.method, request.path);
    } catch (error) {
      if (error instanceof MethodNotAllowedError) {
        return {
          kind: "reject",
          status: 405,
          code: error.code,
          message: error.message,
          headers: { allow: error.allowed.join(", ") },
        };
      }
      if (error instanceof RouteNotFoundError) {
        return { kind: "reject", status: 404, code: error.code, message: error.message };
      }
      throw error;
    }

    const { route, params } = match;
    const auth = evaluateAuth(route, request.ctx, this.options.permissions);
    if (!auth.allowed) {
      return {
        kind: "reject",
        status: auth.status ?? 403,
        code: auth.code ?? "FORBIDDEN",
        message: auth.reason ?? "Not allowed",
        route,
        details: auth.required ? { required: auth.required } : undefined,
      };
    }

    const policy =
      route.rateLimit ??
      (this.options.defaultRateLimit
        ? { ...this.options.defaultRateLimit, key: "tenant" as const }
        : undefined);
    let limitHeaders: Record<string, string> = {};
    if (policy) {
      const key = rateLimitKey(policy, route, request.ctx);
      const decision = this.rateLimits.hit(
        key,
        policy.limit,
        policy.windowMs,
        this.clock.nowMs(),
      );
      limitHeaders = rateLimitHeaders(decision);
      if (!decision.allowed) {
        return {
          kind: "reject",
          status: 429,
          code: "RATE_LIMITED",
          message: `Rate limit of ${policy.limit} requests per ${policy.windowMs}ms exceeded`,
          headers: limitHeaders,
          route,
          details: { key, resetAtMs: decision.resetAtMs },
        };
      }
    }

    const service = this.catalog.get(route.upstream);
    if (!service) {
      const error = new UnknownUpstreamError(route.upstream);
      return { kind: "reject", status: error.status, code: error.code, message: error.message, route };
    }
    if (service.planned) {
      return {
        kind: "reject",
        status: 501,
        code: "UPSTREAM_NOT_IMPLEMENTED",
        message: `${service.label} is declared in the catalog but not deployed yet`,
        route,
      };
    }

    const upstreamPath = resolveUpstreamPath(route, params, service.prefix);
    const targetUrl = `${service.baseUrl.replace(/\/$/, "")}${upstreamPath}${
      request.query ? `?${request.query}` : ""
    }`;

    return {
      kind: "forward",
      route,
      service,
      targetUrl,
      timeoutMs: route.timeoutMs ?? this.options.defaultTimeoutMs ?? 10_000,
      idempotent: route.idempotent ?? isSafeMethod(route.method),
      params,
      responseHeaders: limitHeaders,
      headers: {
        ...this.forwardHeaders(request),
        ...limitHeaders,
        "x-gateway-route": route.id,
        "x-gateway-upstream": service.id,
        "x-forwarded-path": request.path,
      },
    };
  }

  /** Route surface grouped for `/__gateway/routes`. */
  describe(): {
    routes: ReturnType<RouteTable["describe"]>;
    services: ReturnType<ServiceCatalog["list"]>;
    findings: string[];
  } {
    return {
      routes: this.routes.describe(),
      services: this.catalog.list(),
      findings: this.routes.audit(this.catalog.ids()),
    };
  }

  private forwardHeaders(request: GatewayRequest): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(request.headers ?? {})) {
      const key = name.toLowerCase();
      if (value === undefined || HOP_BY_HOP.has(key)) continue;
      out[key] = value;
    }
    if (request.ctx) {
      out["x-tenant-id"] = String(request.ctx.tenantId);
      out["x-user-id"] = String(request.ctx.userId);
      out["x-roles"] = request.ctx.roles.map(String).join(",");
      out["x-request-id"] = String(request.ctx.requestId);
    }
    if (request.clientIp) out["x-forwarded-for"] = request.clientIp;
    return out;
  }
}

function isSafeMethod(method: HttpMethod): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

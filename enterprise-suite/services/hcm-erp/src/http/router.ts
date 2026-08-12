import {
  createTenantContext,
  DomainError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly ctx: TenantContext;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type RouteHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

export function jsonOk(body: unknown, status = 200): HttpResponse {
  return { status, body };
}

export function created(body: unknown): HttpResponse {
  return { status: 201, body };
}

/**
 * Minimal dependency-free router: exact-segment matching with `:param`
 * captures, header-based tenant context, and DomainError → HTTP mapping.
 */
export class Router {
  private readonly routes: Route[] = [];

  register(method: string, pattern: string, handler: RouteHandler): void {
    const segments = pattern.split("/").filter(Boolean);
    this.routes.push({ method: method.toUpperCase(), segments, handler });
  }

  get(pattern: string, handler: RouteHandler): void {
    this.register("GET", pattern, handler);
  }
  post(pattern: string, handler: RouteHandler): void {
    this.register("POST", pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler): void {
    this.register("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler): void {
    this.register("DELETE", pattern, handler);
  }

  /**
   * Dispatches a request. `headers` must carry `x-tenant-id` (401 otherwise);
   * `x-user-id` and `x-roles` (comma-separated) are optional.
   */
  async dispatch(input: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
  }): Promise<HttpResponse> {
    const url = new URL(input.url, "http://localhost");
    const pathSegments = url.pathname.split("/").filter(Boolean);

    const tenantHeader = headerValue(input.headers["x-tenant-id"]);
    if (input.method.toUpperCase() !== "GET" || pathSegments[0] !== "health") {
      if (!tenantHeader) {
        return {
          status: 401,
          body: { error: { code: "MISSING_TENANT", message: "x-tenant-id header is required" } },
        };
      }
    }
    const userHeader = headerValue(input.headers["x-user-id"]) ?? "anonymous";
    const rolesHeader = headerValue(input.headers["x-roles"]);
    const roles = rolesHeader
      ? rolesHeader.split(",").map((r) => r.trim()).filter(Boolean)
      : ["viewer"];
    const ctx = createTenantContext(tenantHeader ?? "unauthenticated", userHeader, roles);

    const match = this.match(input.method.toUpperCase(), pathSegments);
    if (!match) {
      return {
        status: 404,
        body: { error: { code: "ROUTE_NOT_FOUND", message: `No route for ${input.method} ${url.pathname}` } },
      };
    }

    const request: HttpRequest = {
      method: input.method.toUpperCase(),
      path: url.pathname,
      params: match.params,
      query: url.searchParams,
      body: input.body,
      ctx,
    };
    try {
      return await match.route.handler(request);
    } catch (error) {
      return errorToResponse(error);
    }
  }

  private match(
    method: string,
    pathSegments: string[],
  ): { route: Route; params: Record<string, string> } | undefined {
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const routeSegment = route.segments[i];
        const pathSegment = decodeURIComponent(pathSegments[i]);
        if (routeSegment.startsWith(":")) {
          params[routeSegment.slice(1)] = pathSegment;
        } else if (routeSegment !== pathSegment) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return undefined;
  }
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

export function errorToResponse(error: unknown): HttpResponse {
  if (error instanceof DomainError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message, details: error.details } },
    };
  }
  if (error instanceof SyntaxError) {
    return { status: 400, body: { error: { code: "INVALID_JSON", message: error.message } } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 500, body: { error: { code: "INTERNAL", message } } };
}

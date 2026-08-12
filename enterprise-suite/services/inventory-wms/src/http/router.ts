import { DomainError, type TenantContext } from "@enterprise-suite/shared-kernel";

/**
 * Dependency-free HTTP routing core. Handlers are pure async functions from
 * a parsed request to a JSON response, which keeps them unit-testable without
 * sockets. `server.ts` binds this to node:http.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface HttpRequest {
  readonly method: HttpMethod;
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

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

export interface Route {
  readonly method: HttpMethod;
  readonly pattern: string;
  readonly handler: RouteHandler;
}

export function json(status: number, body: unknown): HttpResponse {
  return { status, body };
}

export function created(body: unknown): HttpResponse {
  return json(201, body);
}

export function okJson(body: unknown): HttpResponse {
  return json(200, body);
}

/** Match "/warehouses/:id/zones" against "/warehouses/wh_1/zones". */
export function matchPath(
  pattern: string,
  path: string,
): Record<string, string> | null {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const expected = patternParts[i]!;
    const actual = pathParts[i]!;
    if (expected.startsWith(":")) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, pattern, handler });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add("GET", pattern, handler);
  }

  post(pattern: string, handler: RouteHandler): this {
    return this.add("POST", pattern, handler);
  }

  addAll(routes: readonly Route[]): this {
    for (const route of routes) {
      this.add(route.method, route.pattern, route.handler);
    }
    return this;
  }

  async dispatch(
    method: string,
    path: string,
    query: URLSearchParams,
    body: unknown,
    ctx: TenantContext,
  ): Promise<HttpResponse> {
    let pathMatched = false;
    for (const route of this.routes) {
      const params = matchPath(route.pattern, path);
      if (!params) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      try {
        return await route.handler({
          method: route.method,
          path,
          params,
          query,
          body,
          ctx,
        });
      } catch (error) {
        return toErrorResponse(error);
      }
    }
    if (pathMatched) {
      return json(405, {
        error: { code: "METHOD_NOT_ALLOWED", message: `${method} not allowed on ${path}` },
      });
    }
    return json(404, { error: { code: "NOT_FOUND", message: `No route for ${method} ${path}` } });
  }
}

export function toErrorResponse(error: unknown): HttpResponse {
  if (error instanceof DomainError) {
    return json(error.status, {
      error: { code: error.code, message: error.message, details: error.details ?? undefined },
    });
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return json(500, { error: { code: "INTERNAL", message } });
}

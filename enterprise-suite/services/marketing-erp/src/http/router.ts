import type { TenantContext } from "@enterprise-suite/shared-kernel";

export interface HttpRequest {
  readonly ctx: TenantContext;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface HttpResponse {
  readonly status?: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type RouteHandler = (req: HttpRequest) => HttpResponse | Promise<HttpResponse>;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

export interface RouteMatch {
  readonly handler: RouteHandler;
  readonly params: Record<string, string>;
}

/**
 * Dependency-free path router with `:param` segments. Static segments take
 * priority over parameter segments when both could match.
 */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): this {
    const segments = path.split("/").filter((s) => s.length > 0);
    this.routes.push({ method: method.toUpperCase(), segments, handler });
    // Longer / more-static routes first so `/segments/preview` beats `/segments/:id`.
    this.routes.sort((a, b) => {
      if (a.segments.length !== b.segments.length) return b.segments.length - a.segments.length;
      const statics = (r: Route) => r.segments.filter((s) => !s.startsWith(":")).length;
      return statics(b) - statics(a);
    });
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): this {
    return this.add("PUT", path, handler);
  }

  patch(path: string, handler: RouteHandler): this {
    return this.add("PATCH", path, handler);
  }

  delete(path: string, handler: RouteHandler): this {
    return this.add("DELETE", path, handler);
  }

  match(method: string, pathname: string): RouteMatch | undefined {
    const requestSegments = pathname.split("/").filter((s) => s.length > 0);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== requestSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const expected = route.segments[i]!;
        const actual = requestSegments[i]!;
        if (expected.startsWith(":")) {
          params[expected.slice(1)] = decodeURIComponent(actual);
        } else if (expected !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }
}

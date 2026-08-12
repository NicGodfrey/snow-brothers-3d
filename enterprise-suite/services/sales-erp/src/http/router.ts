import type { IncomingMessage, ServerResponse } from "node:http";
import { NotFoundError, type TenantContext } from "../kernel/index.js";
import { contextFromRequest } from "./context.js";
import { readJsonBody, sendError, sendJson } from "./json.js";

export interface RouteRequest {
  readonly ctx: TenantContext;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface RouteResponse {
  readonly status: number;
  readonly body: unknown;
}

export type RouteHandler = (req: RouteRequest) => RouteResponse | Promise<RouteResponse>;

interface RouteEntry {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
  readonly public_: boolean;
}

export function respond(status: number, body: unknown): RouteResponse {
  return { status, body };
}

/**
 * Minimal method + path-pattern router on plain node:http.
 * Patterns use ":name" segments, e.g. /sales/quotes/:id/lines/:lineId
 */
export class Router {
  private readonly routes: RouteEntry[] = [];

  get(pattern: string, handler: RouteHandler, opts: { public?: boolean } = {}): this {
    return this.add("GET", pattern, handler, opts);
  }

  post(pattern: string, handler: RouteHandler, opts: { public?: boolean } = {}): this {
    return this.add("POST", pattern, handler, opts);
  }

  patch(pattern: string, handler: RouteHandler, opts: { public?: boolean } = {}): this {
    return this.add("PATCH", pattern, handler, opts);
  }

  delete(pattern: string, handler: RouteHandler, opts: { public?: boolean } = {}): this {
    return this.add("DELETE", pattern, handler, opts);
  }

  private add(method: string, pattern: string, handler: RouteHandler, opts: { public?: boolean }): this {
    this.routes.push({
      method,
      segments: pattern.split("/").filter((s) => s.length > 0),
      handler,
      public_: opts.public ?? false,
    });
    return this;
  }

  /** node:http request listener. */
  handler() {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const pathSegments = url.pathname.split("/").filter((s) => s.length > 0);
        const match = this.match(req.method ?? "GET", pathSegments);
        if (!match) {
          throw new NotFoundError("Route", `${req.method} ${url.pathname}`);
        }
        const ctx = match.entry.public_
          ? undefined
          : contextFromRequest(req);
        const body = req.method === "GET" || req.method === "DELETE" ? {} : await readJsonBody(req);
        const response = await match.entry.handler({
          // public routes never read ctx; non-null assertion is safe for the rest
          ctx: ctx as TenantContext,
          params: match.params,
          query: url.searchParams,
          body,
        });
        sendJson(res, response.status, response.body);
      } catch (error) {
        sendError(res, error);
      }
    };
  }

  private match(
    method: string,
    pathSegments: readonly string[],
  ): { entry: RouteEntry; params: Record<string, string> } | undefined {
    for (const entry of this.routes) {
      if (entry.method !== method) continue;
      if (entry.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < entry.segments.length; i += 1) {
        const patternSegment = entry.segments[i];
        if (patternSegment.startsWith(":")) {
          params[patternSegment.slice(1)] = decodeURIComponent(pathSegments[i]);
        } else if (patternSegment !== pathSegments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { entry, params };
    }
    return undefined;
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError, type TenantContext } from "@enterprise-suite/shared-kernel";
import { extractTenantContext } from "./context.js";

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly ctx: TenantContext;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type Handler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

export const jsonOk = (body: unknown): HttpResponse => ({ status: 200, body });
export const jsonCreated = (body: unknown): HttpResponse => ({ status: 201, body });

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

/**
 * Minimal path-segment router (no external dependencies). Patterns use
 * ":name" segments, e.g. "/journals/:id/post".
 */
export class Router {
  private readonly routes: Route[] = [];

  register(method: string, pattern: string, handler: Handler): void {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter((s) => s.length > 0),
      handler,
    });
  }

  get(pattern: string, handler: Handler): void { this.register("GET", pattern, handler); }
  post(pattern: string, handler: Handler): void { this.register("POST", pattern, handler); }
  put(pattern: string, handler: Handler): void { this.register("PUT", pattern, handler); }
  delete(pattern: string, handler: Handler): void { this.register("DELETE", pattern, handler); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
    const parts = path.split("/").filter((s) => s.length > 0);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i++) {
        const segment = route.segments[i];
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(parts[i]);
        } else if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }

  async dispatch(input: {
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    rawBody: string;
  }): Promise<HttpResponse> {
    const url = new URL(input.url, "http://localhost");
    const found = this.match(input.method, url.pathname);
    if (!found) {
      return { status: 404, body: { error: "NOT_FOUND", message: `no route ${input.method} ${url.pathname}` } };
    }

    let body: unknown;
    if (input.rawBody.length > 0) {
      try {
        body = JSON.parse(input.rawBody);
      } catch {
        return { status: 400, body: { error: "BAD_JSON", message: "request body is not valid JSON" } };
      }
    }

    let ctx: TenantContext;
    try {
      ctx = extractTenantContext(input.headers);
    } catch (e) {
      return { status: 401, body: { error: "UNAUTHENTICATED", message: (e as Error).message } };
    }

    try {
      return await found.handler({
        method: input.method.toUpperCase(),
        path: url.pathname,
        params: found.params,
        query: url.searchParams,
        body,
        ctx,
      });
    } catch (e) {
      if (e instanceof DomainError) {
        return {
          status: e.status,
          body: { error: e.code, message: e.message, details: e.details },
        };
      }
      return {
        status: 500,
        body: { error: "INTERNAL", message: (e as Error).message ?? "unexpected error" },
      };
    }
  }

  /** Adapter for node:http.createServer. */
  nodeListener(): (req: IncomingMessage, res: ServerResponse) => void {
    return (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        void this.dispatch({
          method: req.method ?? "GET",
          url: req.url ?? "/",
          headers: req.headers,
          rawBody: Buffer.concat(chunks).toString("utf8"),
        }).then((response) => {
          const payload = JSON.stringify(response.body ?? null);
          res.writeHead(response.status, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload),
          });
          res.end(payload);
        });
      });
    };
  }
}

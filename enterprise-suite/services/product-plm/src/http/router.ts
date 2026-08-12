import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DomainError,
  createTenantContext,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";

/**
 * Dependency-free HTTP micro-router for node:http.
 *
 * Route patterns are static segments plus `:param` captures
 * ("/products/:id/bom"). Handlers get a parsed JSON body, query params, path
 * params and the tenant context extracted from `x-tenant-id` / `x-user-id` /
 * `x-roles` headers. Domain errors map to their declared HTTP status.
 */

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
  readonly body?: unknown;
}

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;

export function jsonResponse(status: number, body?: unknown): HttpResponse {
  return { status, body };
}

interface CompiledRoute {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

const MAX_BODY_BYTES = 1_000_000;

export class Router {
  private readonly routes: CompiledRoute[] = [];

  get(pattern: string, handler: RouteHandler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: RouteHandler): this {
    return this.add("POST", pattern, handler);
  }
  put(pattern: string, handler: RouteHandler): this {
    return this.add("PUT", pattern, handler);
  }
  patch(pattern: string, handler: RouteHandler): this {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: RouteHandler): this {
    return this.add("DELETE", pattern, handler);
  }

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  match(
    method: string,
    path: string,
  ): { handler: RouteHandler; params: Record<string, string> } | undefined {
    const parts = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < parts.length; i += 1) {
        const segment = route.segments[i]!;
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(parts[i]!);
        } else if (segment !== parts[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }

  /** node:http request listener with body parsing and error mapping. */
  listener() {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const started = Date.now();
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const found = this.match(req.method ?? "GET", url.pathname);
        if (!found) {
          send(res, 404, { code: "ROUTE_NOT_FOUND", message: `${req.method} ${url.pathname}` });
          return;
        }
        if (url.pathname !== "/health") {
          const tenant = header(req, "x-tenant-id");
          if (!tenant) {
            send(res, 400, { code: "TENANT_REQUIRED", message: "x-tenant-id header is required" });
            return;
          }
        }
        const ctx = createTenantContext(
          header(req, "x-tenant-id") ?? "anonymous",
          header(req, "x-user-id") ?? "anonymous",
          (header(req, "x-roles") ?? "viewer").split(",").map((r) => r.trim()).filter(Boolean),
        );
        const body = await readBody(req);
        const response = await found.handler({
          method: req.method ?? "GET",
          path: url.pathname,
          params: found.params,
          query: url.searchParams,
          body,
          ctx,
        });
        send(res, response.status, response.body);
      } catch (error) {
        if (error instanceof DomainError) {
          send(res, error.status, { code: error.code, message: error.message, details: error.details });
        } else if (error instanceof SyntaxError) {
          send(res, 400, { code: "BAD_JSON", message: "Request body is not valid JSON" });
        } else {
          // eslint-disable-next-line no-console
          console.error(`[product-plm] unhandled error after ${Date.now() - started}ms`, error);
          send(res, 500, { code: "INTERNAL", message: "Internal server error" });
        }
      }
    };
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "DELETE") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new DomainError("Request body too large", "PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw.length === 0 ? undefined : JSON.parse(raw);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

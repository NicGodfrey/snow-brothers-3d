import type { IncomingMessage, ServerResponse } from "node:http";
import {
  DomainError,
  createTenantContext,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";

export interface RequestContext {
  readonly tenant: TenantContext;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface HttpResult {
  readonly status: number;
  readonly body: unknown;
}

export type RouteHandler = (rc: RequestContext) => Promise<HttpResult> | HttpResult;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

const MAX_BODY_BYTES = 1_000_000;

/**
 * Minimal dependency-free HTTP router: exact-segment matching with
 * `:param` placeholders, JSON bodies, tenant-context extraction from
 * headers, and uniform DomainError → HTTP status mapping.
 */
export class Router {
  private readonly routes: Route[] = [];

  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }

  patch(path: string, handler: RouteHandler): this {
    return this.add("PATCH", path, handler);
  }

  delete(path: string, handler: RouteHandler): this {
    return this.add("DELETE", path, handler);
  }

  add(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: path.split("/").filter(Boolean), handler });
    return this;
  }

  /** Matches a method+path; exported for unit testing. */
  match(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | undefined {
    const parts = pathname.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i++) {
        const segment = route.segments[i]!;
        const part = parts[i]!;
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(part);
        } else if (segment !== part) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return undefined;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      const found = this.match(req.method ?? "GET", url.pathname);
      if (found === undefined) {
        respond(res, 404, {
          error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${url.pathname}` },
        });
        return;
      }
      const body = await readJsonBody(req);
      // Tenant extraction is lazy so tenant-less routes (e.g. /health)
      // do not require identity headers.
      let cachedTenant: TenantContext | undefined;
      const result = await found.handler({
        get tenant(): TenantContext {
          cachedTenant ??= extractTenantContext(req);
          return cachedTenant;
        },
        params: found.params,
        query: url.searchParams,
        body,
      });
      respond(res, result.status, result.body);
    } catch (error) {
      if (error instanceof DomainError) {
        respond(res, error.status, {
          error: { code: error.code, message: error.message, details: error.details },
        });
        return;
      }
      respond(res, 500, {
        error: {
          code: "INTERNAL",
          message: error instanceof Error ? error.message : "Unexpected error",
        },
      });
    }
  }
}

/**
 * Builds the tenant context from the suite's identity headers
 * (`x-tenant-id`, `x-user-id`, `x-roles`). Every data route requires a
 * tenant; routes that never read `rc.tenant` (e.g. /health) work without.
 */
export function extractTenantContext(req: IncomingMessage): TenantContext {
  const tenant = headerValue(req, "x-tenant-id");
  if (tenant === undefined || tenant.trim().length === 0) {
    throw new DomainError("Missing x-tenant-id header", "UNAUTHENTICATED", 401);
  }
  const user = headerValue(req, "x-user-id") ?? "anonymous";
  const roles = (headerValue(req, "x-roles") ?? "viewer")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return createTenantContext(tenant.trim(), user, roles);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "DELETE") return undefined;
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
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
  }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

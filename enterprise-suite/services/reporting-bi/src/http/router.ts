/**
 * Dependency-free HTTP router over node:http.
 *
 * - path patterns with :params ("/dashboards/:code/tiles/:tileId")
 * - tenant context from x-tenant-id / x-user-id / x-roles headers
 * - JSON bodies (4 MiB limit — ingest batches are chunky), JSON responses
 * - handlers may return a raw body (CSV download) with their own content type
 * - DomainError subclasses map to their status; anything else is a 500
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createTenantContext,
  DomainError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";

export interface RequestContext {
  readonly ctx: TenantContext;
  readonly params: Record<string, string>;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface HandlerResult {
  readonly status?: number;
  readonly body?: unknown;
  /** Raw payload; when present it is sent verbatim with `contentType`. */
  readonly raw?: string;
  readonly contentType?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export type RouteHandler = (req: RequestContext) => Promise<HandlerResult> | HandlerResult;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Route {
  readonly method: Method;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export class Router {
  private readonly routes: Route[] = [];

  register(method: Method, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
  }

  get(pattern: string, handler: RouteHandler): void { this.register("GET", pattern, handler); }
  post(pattern: string, handler: RouteHandler): void { this.register("POST", pattern, handler); }
  put(pattern: string, handler: RouteHandler): void { this.register("PUT", pattern, handler); }
  patch(pattern: string, handler: RouteHandler): void { this.register("PATCH", pattern, handler); }
  delete(pattern: string, handler: RouteHandler): void { this.register("DELETE", pattern, handler); }

  /** Registered routes, for the self-describing index endpoint. */
  describe(): { method: string; path: string }[] {
    return this.routes.map((route) => ({
      method: route.method,
      path: `/${route.segments.join("/")}`,
    }));
  }

  private match(
    method: string,
    path: string,
  ): { route: Route; params: Record<string, string> } | null {
    const pathSegments = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const pattern = route.segments[i]!;
        const actual = pathSegments[i]!;
        if (pattern.startsWith(":")) {
          params[pattern.slice(1)] = decodeURIComponent(actual);
        } else if (pattern !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const matched = this.match(req.method ?? "GET", url.pathname);
      if (!matched) {
        sendJson(res, 404, {
          error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${url.pathname}` },
        });
        return;
      }

      const isPublic = url.pathname === "/health" || url.pathname === "/";
      const tenantHeader = header(req, "x-tenant-id");
      const userHeader = header(req, "x-user-id");
      if (!isPublic && (!tenantHeader || !userHeader)) {
        sendJson(res, 401, {
          error: {
            code: "MISSING_TENANT_CONTEXT",
            message: "x-tenant-id and x-user-id headers are required",
          },
        });
        return;
      }
      const roles = (header(req, "x-roles") ?? "viewer")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean);
      const ctx = createTenantContext(tenantHeader ?? "system", userHeader ?? "system", roles);

      const body = await readJsonBody(req);
      const result = await matched.route.handler({
        ctx,
        params: matched.params,
        query: url.searchParams,
        body,
      });

      if (result.raw !== undefined) {
        sendRaw(res, result.status ?? 200, result.raw, result.contentType ?? "text/plain; charset=utf-8", result.headers);
        return;
      }
      sendJson(res, result.status ?? 200, result.body ?? null, result.headers);
    } catch (error) {
      if (error instanceof DomainError) {
        sendJson(res, error.status, {
          error: { code: error.code, message: error.message, details: error.details },
        });
        return;
      }
      sendJson(res, 500, {
        error: { code: "INTERNAL", message: error instanceof Error ? error.message : "Unknown error" },
      });
    }
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "DELETE") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new DomainError("Request body too large", "PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers?: Readonly<Record<string, string>>,
): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

export function sendRaw(
  res: ServerResponse,
  status: number,
  content: string,
  contentType: string,
  headers?: Readonly<Record<string, string>>,
): void {
  res.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(content),
    ...headers,
  });
  res.end(content);
}

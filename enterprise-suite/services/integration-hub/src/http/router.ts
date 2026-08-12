/**
 * Dependency-free HTTP router over node:http.
 *
 * Same shape as the other services (path params, tenant headers, JSON in and
 * out, DomainError -> status mapping), with two additions the hub needs:
 *  - the raw request body is preserved, because verifying an inbound webhook
 *    signature requires the exact bytes that were signed;
 *  - request headers are exposed to handlers so `Idempotency-Key` and partner
 *    signature headers can be read.
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
  readonly rawBody: string;
  readonly headers: Record<string, string>;
}

export interface HandlerResult {
  readonly status?: number;
  readonly body: unknown;
  readonly headers?: Record<string, string>;
}

export type RouteHandler = (req: RequestContext) => Promise<HandlerResult> | HandlerResult;

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface Route {
  readonly method: Method;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const UNAUTHENTICATED_PATHS = new Set(["/health", "/ready", "/adapters/drivers"]);

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
      for (let i = 0; i < route.segments.length; i++) {
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

      const headers = flattenHeaders(req);
      const open = UNAUTHENTICATED_PATHS.has(url.pathname);
      const tenantHeader = headers["x-tenant-id"];
      const userHeader = headers["x-user-id"];
      if (!open && (!tenantHeader || !userHeader)) {
        sendJson(res, 401, {
          error: {
            code: "MISSING_TENANT_CONTEXT",
            message: "x-tenant-id and x-user-id headers are required",
          },
        });
        return;
      }
      const roles = (headers["x-roles"] ?? "viewer")
        .split(",")
        .map((role) => role.trim())
        .filter(Boolean);
      const ctx = createTenantContext(tenantHeader ?? "system", userHeader ?? "system", roles);

      const rawBody = await readBody(req);
      const result = await matched.route.handler({
        ctx,
        params: matched.params,
        query: url.searchParams,
        body: parseJson(rawBody),
        rawBody,
        headers,
      });
      sendJson(res, result.status ?? 200, result.body, result.headers);
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

function flattenHeaders(req: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers[key.toLowerCase()] = Array.isArray(value) ? (value[0] ?? "") : value;
  }
  return headers;
}

async function readBody(req: IncomingMessage): Promise<string> {
  if (req.method === "GET" || req.method === "DELETE") return "";
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
  return Buffer.concat(chunks).toString("utf8");
}

function parseJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
  }
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    ...extraHeaders,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

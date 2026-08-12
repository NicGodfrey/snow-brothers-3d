import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError, type TenantContext } from "@enterprise-suite/shared-kernel";
import { createTenantContext } from "@enterprise-suite/shared-kernel";

/**
 * Minimal dependency-free HTTP router. Patterns use `:name` path params
 * (e.g. `/work-orders/:id/release`). Handlers return either a plain body
 * (200) or `{ status, body }`.
 */

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly ctx: TenantContext;
}

export interface HandlerResult {
  status: number;
  body: unknown;
}

export type Handler = (req: HttpRequest) => Promise<HandlerResult | unknown>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private readonly routes: Route[] = [];

  get(pattern: string, handler: Handler): this {
    return this.register("GET", pattern, handler);
  }

  post(pattern: string, handler: Handler): this {
    return this.register("POST", pattern, handler);
  }

  patch(pattern: string, handler: Handler): this {
    return this.register("PATCH", pattern, handler);
  }

  delete(pattern: string, handler: Handler): this {
    return this.register("DELETE", pattern, handler);
  }

  register(method: string, pattern: string, handler: Handler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split("/").filter(Boolean),
      handler,
    });
    return this;
  }

  /** Find a route and extract path params; null if nothing matches. */
  match(
    method: string,
    path: string,
  ): { handler: Handler; params: Record<string, string> } | null {
    const pathSegments = path.split("/").filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const routeSeg = route.segments[i]!;
        const pathSeg = pathSegments[i]!;
        if (routeSeg.startsWith(":")) {
          params[routeSeg.slice(1)] = decodeURIComponent(pathSeg);
        } else if (routeSeg !== pathSeg) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, params };
    }
    return null;
  }

  /** Node http request listener with body parsing and error mapping. */
  listener() {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const matchResult = this.match(req.method ?? "GET", url.pathname);
        if (!matchResult) {
          sendJson(res, 404, {
            error: { code: "ROUTE_NOT_FOUND", message: `${req.method} ${url.pathname}` },
          });
          return;
        }
        const ctx = isHealthPath(url.pathname)
          ? createTenantContext("system", "health-probe", [])
          : contextFromHeaders(req);
        const body = await readJsonBody(req);
        const result = await matchResult.handler({
          method: req.method ?? "GET",
          path: url.pathname,
          params: matchResult.params,
          query: url.searchParams,
          body,
          ctx,
        });
        if (isHandlerResult(result)) {
          sendJson(res, result.status, wrapBody(result.body));
        } else {
          sendJson(res, 200, wrapBody(result));
        }
      } catch (error) {
        handleError(res, error);
      }
    };
  }
}

function isHealthPath(path: string): boolean {
  return path === "/health" || path.startsWith("/health/");
}

function isHandlerResult(value: unknown): value is HandlerResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    typeof (value as HandlerResult).status === "number" &&
    "body" in value
  );
}

function wrapBody(body: unknown): unknown {
  if (body === undefined || body === null) return { data: null };
  if (typeof body === "object" && body !== null && ("data" in body || "error" in body)) {
    return body;
  }
  return { data: body };
}

function contextFromHeaders(req: IncomingMessage): TenantContext {
  const tenant = headerValue(req, "x-tenant-id");
  if (!tenant) {
    throw new DomainError("Missing x-tenant-id header", "TENANT_REQUIRED", 401);
  }
  const user = headerValue(req, "x-user-id") ?? "anonymous";
  const roles = (headerValue(req, "x-roles") ?? "viewer")
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
  return createTenantContext(tenant, user, roles);
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw ?? undefined;
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "DELETE") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
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

function handleError(res: ServerResponse, error: unknown): void {
  if (error instanceof DomainError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details ?? null },
    });
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  sendJson(res, 500, { error: { code: "INTERNAL", message } });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

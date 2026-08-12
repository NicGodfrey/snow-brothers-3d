import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError, type TenantContext } from "@enterprise-suite/shared-kernel";
import { extractTenantContext } from "./context.js";

export interface HttpRequest {
  readonly ctx: TenantContext;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse>;

interface Route {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
  /** Health-style routes skip tenant authentication. */
  readonly anonymous: boolean;
}

const MAX_BODY_BYTES = 1_048_576;

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler, options?: { anonymous?: boolean }): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: path.split("/").filter(Boolean),
      handler,
      anonymous: options?.anonymous ?? false,
    });
    return this;
  }

  get(path: string, handler: RouteHandler, options?: { anonymous?: boolean }): this {
    return this.add("GET", path, handler, options);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }

  put(path: string, handler: RouteHandler): this {
    return this.add("PUT", path, handler);
  }

  delete(path: string, handler: RouteHandler): this {
    return this.add("DELETE", path, handler);
  }

  async dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? "/", "http://internal");
      const segments = url.pathname.split("/").filter(Boolean);
      const match = this.match(req.method ?? "GET", segments);
      if (!match) {
        return send(res, 404, { error: { code: "NOT_FOUND", message: `No route for ${req.method} ${url.pathname}` } });
      }
      const ctx = match.route.anonymous
        ? extractTenantContext(req.headers, { optional: true })
        : extractTenantContext(req.headers);
      const body = await readJsonBody(req);
      const query: Record<string, string> = {};
      for (const [key, value] of url.searchParams) query[key] = value;
      const response = await match.route.handler({ ctx, params: match.params, query, body });
      send(res, response.status, response.body);
    } catch (error) {
      if (error instanceof DomainError) {
        send(res, error.status, {
          error: { code: error.code, message: error.message, details: error.details ?? undefined },
        });
      } else {
        send(res, 500, {
          error: { code: "INTERNAL", message: error instanceof Error ? error.message : "Unexpected error" },
        });
      }
    }
  }

  private match(
    method: string,
    segments: readonly string[],
  ): { route: Route; params: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method || route.segments.length !== segments.length) continue;
      const params: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < segments.length; i += 1) {
        const pattern = route.segments[i];
        if (pattern.startsWith(":")) params[pattern.slice(1)] = decodeURIComponent(segments[i]);
        else if (pattern !== segments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) {
      throw new DomainError("Request body exceeds 1 MiB", "PAYLOAD_TOO_LARGE", 413);
    }
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

function send(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

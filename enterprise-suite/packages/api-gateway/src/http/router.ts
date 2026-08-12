import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError, createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import {
  compareSpecificity,
  compilePattern,
  matchPattern,
  splitPath,
  type CompiledPattern,
  type HttpMethod,
} from "../domain/route.js";

/**
 * Dependency-free HTTP kernel shared by the gateway and by the apps that sit
 * behind it. It is the same specificity-ordered matcher the route table uses,
 * plus an onion middleware chain so cross-cutting concerns (tenant context,
 * request ids, throttling, error mapping, access logs) compose in one place.
 */

export interface HttpRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly rawUrl: string;
  readonly clientIp?: string;
  /** Populated by the tenant middleware; anonymous until then. */
  ctx: TenantContext;
  /** Scratch space for middleware to hand values to handlers. */
  readonly locals: Record<string, unknown>;
}

export interface HttpResponse {
  readonly status: number;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** Defaults to `application/json; charset=utf-8`. */
  readonly contentType?: string;
  /** Pre-rendered payload used for HTML/text responses. */
  readonly raw?: string;
}

export type RouteHandler = (req: HttpRequest) => Promise<HttpResponse> | HttpResponse;
export type Middleware = (
  req: HttpRequest,
  next: () => Promise<HttpResponse>,
) => Promise<HttpResponse>;

export function json(status: number, body?: unknown, headers?: Record<string, string>): HttpResponse {
  return { status, body, headers };
}

export function html(status: number, markup: string): HttpResponse {
  return { status, raw: markup, contentType: "text/html; charset=utf-8" };
}

export function text(status: number, value: string): HttpResponse {
  return { status, raw: value, contentType: "text/plain; charset=utf-8" };
}

export function noContent(headers?: Record<string, string>): HttpResponse {
  return { status: 204, headers };
}

export const ANONYMOUS_CONTEXT_TENANT = "anonymous";

interface RegisteredRoute {
  readonly method: HttpMethod;
  readonly compiled: CompiledPattern;
  readonly handler: RouteHandler;
  readonly name?: string;
}

const MAX_BODY_BYTES = 2_000_000;

export interface RouterOptions {
  readonly maxBodyBytes?: number;
  readonly serviceName?: string;
  readonly onError?: (error: unknown, req: Partial<HttpRequest>) => void;
}

export class Router {
  private readonly routes: RegisteredRoute[] = [];
  private readonly middleware: Middleware[] = [];
  private sorted = true;

  constructor(private readonly options: RouterOptions = {}) {}

  use(middleware: Middleware): this {
    this.middleware.push(middleware);
    return this;
  }

  get(pattern: string, handler: RouteHandler, name?: string): this {
    return this.add("GET", pattern, handler, name);
  }
  post(pattern: string, handler: RouteHandler, name?: string): this {
    return this.add("POST", pattern, handler, name);
  }
  put(pattern: string, handler: RouteHandler, name?: string): this {
    return this.add("PUT", pattern, handler, name);
  }
  patch(pattern: string, handler: RouteHandler, name?: string): this {
    return this.add("PATCH", pattern, handler, name);
  }
  delete(pattern: string, handler: RouteHandler, name?: string): this {
    return this.add("DELETE", pattern, handler, name);
  }

  add(method: HttpMethod, pattern: string, handler: RouteHandler, name?: string): this {
    this.routes.push({ method, compiled: compilePattern(pattern), handler, name });
    this.sorted = false;
    return this;
  }

  /** Mounts another router's routes under a prefix, keeping its middleware. */
  mount(prefix: string, other: Router): this {
    for (const route of other.export()) {
      const pattern = `${prefix === "/" ? "" : prefix}${route.compiled.source}`;
      this.routes.push({ ...route, compiled: compilePattern(pattern) });
    }
    this.sorted = false;
    return this;
  }

  export(): readonly RegisteredRoute[] {
    return this.routes;
  }

  patterns(): string[] {
    return this.ordered().map((route) => `${route.method} ${route.compiled.source}`);
  }

  match(method: string, path: string): { route: RegisteredRoute; params: Record<string, string> } | undefined {
    const parts = splitPath(path);
    for (const route of this.ordered()) {
      if (route.method !== method) continue;
      const params = matchPattern(route.compiled, parts);
      if (params) return { route, params };
    }
    return undefined;
  }

  allowedMethods(path: string): string[] {
    const parts = splitPath(path);
    const methods = new Set<string>();
    for (const route of this.routes) {
      if (matchPattern(route.compiled, parts)) methods.add(route.method);
    }
    return [...methods].sort();
  }

  /** Runs the middleware chain and the matched handler. */
  async handle(req: HttpRequest): Promise<HttpResponse> {
    const found = this.match(req.method, req.path);
    const request: HttpRequest = found ? { ...req, params: found.params } : req;
    // Named before the chain runs so authorization middleware can look up the
    // requirement for the route it is about to guard.
    if (found) request.locals["routeName"] = found.route.name ?? found.route.compiled.source;

    const terminal = async (): Promise<HttpResponse> => {
      if (!found) {
        const allowed = this.allowedMethods(req.path);
        if (allowed.length > 0) {
          return json(
            405,
            { code: "METHOD_NOT_ALLOWED", message: `${req.method} ${req.path}`, allowed },
            { allow: allowed.join(", ") },
          );
        }
        return json(404, { code: "ROUTE_NOT_FOUND", message: `${req.method} ${req.path}` });
      }
      return found.route.handler(request);
    };

    let index = -1;
    const dispatch = async (i: number): Promise<HttpResponse> => {
      if (i <= index) throw new Error("next() called more than once in a middleware");
      index = i;
      const middleware = this.middleware[i];
      if (!middleware) return terminal();
      return middleware(request, () => dispatch(i + 1));
    };
    return dispatch(0);
  }

  /** node:http adapter: parses the request, runs the chain, writes the response. */
  listener() {
    return async (incoming: IncomingMessage, res: ServerResponse): Promise<void> => {
      let request: HttpRequest | undefined;
      try {
        const url = new URL(incoming.url ?? "/", "http://localhost");
        const body = await readBody(incoming, this.options.maxBodyBytes ?? MAX_BODY_BYTES);
        request = {
          method: incoming.method ?? "GET",
          path: url.pathname,
          params: {},
          query: url.searchParams,
          headers: normalizeHeaders(incoming),
          body,
          rawUrl: incoming.url ?? "/",
          clientIp: incoming.socket.remoteAddress ?? undefined,
          ctx: createTenantContext(ANONYMOUS_CONTEXT_TENANT, ANONYMOUS_CONTEXT_TENANT, []),
          locals: {},
        };
        const response = await this.handle(request);
        send(res, response);
      } catch (error) {
        this.options.onError?.(error, request ?? {});
        send(res, toErrorResponse(error, this.options.serviceName ?? "api-gateway"));
      }
    };
  }

  private ordered(): readonly RegisteredRoute[] {
    if (!this.sorted) {
      this.routes.sort((a, b) => compareSpecificity(a.compiled, b.compiled));
      this.sorted = true;
    }
    return this.routes;
  }
}

export function toErrorResponse(error: unknown, service: string): HttpResponse {
  if (error instanceof DomainError) {
    return json(error.status, {
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }
  if (error instanceof SyntaxError) {
    return json(400, { code: "BAD_JSON", message: "Request body is not valid JSON" });
  }
  return json(500, {
    code: "INTERNAL",
    message: "Internal server error",
    details: { service },
  });
}

export function normalizeHeaders(incoming: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(",") : value;
  }
  return out;
}

export async function readBody(incoming: IncomingMessage, maxBytes: number): Promise<unknown> {
  const method = incoming.method ?? "GET";
  if (method === "GET" || method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new DomainError("Request body too large", "PAYLOAD_TOO_LARGE", 413);
    }
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw.length === 0) return undefined;
  const contentType = incoming.headers["content-type"] ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return JSON.parse(raw);
}

export function send(res: ServerResponse, response: HttpResponse): void {
  const payload =
    response.raw !== undefined
      ? response.raw
      : response.body === undefined
        ? ""
        : JSON.stringify(response.body);
  const headers: Record<string, string> = {
    "content-type": response.contentType ?? "application/json; charset=utf-8",
    "content-length": String(Buffer.byteLength(payload)),
    ...(response.headers ?? {}),
  };
  if (payload.length === 0) delete headers["content-type"];
  res.writeHead(response.status, headers);
  res.end(payload);
}

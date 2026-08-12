import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "@enterprise-suite/shared-kernel";
import type { PortalSession } from "../domain/session.js";
import type { Html } from "./views/html.js";
import { render } from "./views/html.js";

/**
 * Dependency-free HTTP router for node:http.
 *
 * Patterns are static segments plus `:param` captures. Handlers receive parsed
 * cookies, query and body, plus the resolved session (or `undefined` for
 * anonymous requests). Responses are JSON, HTML, redirects or raw text; error
 * mapping picks the representation from the route family.
 */

export interface PortalRequest {
  readonly method: string;
  readonly path: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly cookies: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly session?: PortalSession;
}

export interface PortalResponse {
  readonly status: number;
  readonly body?: string;
  readonly json?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  readonly contentType?: string;
}

export type Handler = (req: PortalRequest) => Promise<PortalResponse> | PortalResponse;

export function json(status: number, body: unknown): PortalResponse {
  return { status, json: body };
}

export function htmlResponse(status: number, markup: Html): PortalResponse {
  return { status, body: render(markup), contentType: "text/html; charset=utf-8" };
}

export function redirect(location: string, cookies: readonly string[] = []): PortalResponse {
  return {
    status: 303,
    headers: cookieHeaders(cookies, { location }),
  };
}

export function withCookies(
  response: PortalResponse,
  cookies: readonly string[],
): PortalResponse {
  return { ...response, headers: cookieHeaders(cookies, { ...response.headers }) };
}

function cookieHeaders(
  cookies: readonly string[],
  base: Record<string, string>,
): Record<string, string> {
  if (cookies.length === 0) return base;
  // node's writeHead accepts a joined value only for a single cookie; multiple
  // cookies are emitted through the array form handled in `send`.
  return { ...base, "set-cookie": cookies.join("\u0000") };
}

export interface RouteContext {
  /** Resolves the session for a request, or throws to force a sign-in. */
  resolveSession(headers: Readonly<Record<string, string | undefined>>, cookies: Readonly<Record<string, string>>): PortalSession | undefined;
  onError?(error: unknown, req: { method: string; path: string }): void;
}

interface CompiledRoute {
  readonly method: string;
  readonly segments: readonly string[];
  readonly handler: Handler;
}

const MAX_BODY_BYTES = 512_000;

export class Router {
  private readonly routes: CompiledRoute[] = [];

  constructor(private readonly context: RouteContext) {}

  get(pattern: string, handler: Handler): this {
    return this.add("GET", pattern, handler);
  }
  post(pattern: string, handler: Handler): this {
    return this.add("POST", pattern, handler);
  }
  patch(pattern: string, handler: Handler): this {
    return this.add("PATCH", pattern, handler);
  }
  delete(pattern: string, handler: Handler): this {
    return this.add("DELETE", pattern, handler);
  }

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: pattern.split("/").filter(Boolean), handler });
    return this;
  }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
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

  listener() {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      const wantsJson = url.pathname.startsWith("/api/");
      try {
        const found = this.match(method, url.pathname);
        if (!found) {
          send(res, notFound(url.pathname, wantsJson));
          return;
        }
        const headers = normalizeHeaders(req);
        const cookies = parseCookies(headers.cookie);
        const response = await found.handler({
          method,
          path: url.pathname,
          params: found.params,
          query: url.searchParams,
          headers,
          cookies,
          body: await readBody(req, headers["content-type"]),
          session: this.context.resolveSession(headers, cookies),
        });
        send(res, response);
      } catch (error) {
        this.context.onError?.(error, { method, path: url.pathname });
        send(res, errorResponse(error, wantsJson));
      }
    };
  }
}

function notFound(path: string, wantsJson: boolean): PortalResponse {
  return wantsJson
    ? json(404, { code: "ROUTE_NOT_FOUND", message: path })
    : { status: 404, body: `Not found: ${path}`, contentType: "text/plain; charset=utf-8" };
}

export function errorResponse(error: unknown, wantsJson: boolean): PortalResponse {
  const domain =
    error instanceof DomainError
      ? { status: error.status, code: error.code, message: error.message, details: error.details }
      : error instanceof SyntaxError
        ? { status: 400, code: "BAD_JSON", message: "Request body is not valid JSON", details: undefined }
        : { status: 500, code: "INTERNAL", message: "Internal server error", details: undefined };
  if (wantsJson) {
    return json(domain.status, { code: domain.code, message: domain.message, details: domain.details });
  }
  return {
    status: domain.status,
    body: `${domain.code}: ${domain.message}`,
    contentType: "text/plain; charset=utf-8",
  };
}

export function normalizeHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    if (name.length === 0) continue;
    cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return cookies;
}

async function readBody(req: IncomingMessage, contentType: string | undefined): Promise<unknown> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
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
  const rawBody = Buffer.concat(chunks).toString("utf8").trim();
  if (rawBody.length === 0) return undefined;
  if (contentType?.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(rawBody).entries());
  }
  return JSON.parse(rawBody);
}

function send(res: ServerResponse, response: PortalResponse): void {
  const headers: Record<string, string | string[]> = { ...response.headers };
  const setCookie = response.headers?.["set-cookie"];
  if (setCookie !== undefined) headers["set-cookie"] = setCookie.split("\u0000");

  const payload =
    response.json !== undefined ? JSON.stringify(response.json) : (response.body ?? "");
  headers["content-type"] =
    response.json !== undefined
      ? "application/json; charset=utf-8"
      : (response.contentType ?? "text/plain; charset=utf-8");
  headers["content-length"] = String(Buffer.byteLength(payload));
  headers["x-content-type-options"] = "nosniff";
  res.writeHead(response.status, headers);
  res.end(payload);
}

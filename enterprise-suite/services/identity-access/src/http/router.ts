import type { IncomingMessage, ServerResponse } from "node:http";
import { NotFoundError, type Ulid } from "@enterprise-suite/shared-kernel";
import type { AuthenticationService } from "../application/authentication-service.js";
import type { AuthorizationService } from "../application/authorization-service.js";
import type { Principal } from "../application/principal.js";
import { identifyRequest } from "./context.js";
import { readJsonBody, sendError, sendJson } from "./json.js";

export interface RouteRequest {
  readonly principal: Principal;
  readonly params: Readonly<Record<string, string>>;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly correlationId: Ulid;
  readonly ip?: string;
}

export interface RouteResponse {
  readonly status: number;
  readonly body: unknown;
}

export type RouteHandler = (req: RouteRequest) => RouteResponse | Promise<RouteResponse>;

export interface RouteOptions {
  /** Skips authentication entirely (health checks, login). */
  readonly public?: boolean;
  /** Permission required before the handler runs. */
  readonly permission?: string;
  /** Reads the scope for the permission check from a query parameter or path param. */
  readonly scopeFrom?: string;
}

interface RouteEntry {
  readonly method: string;
  readonly pattern: string;
  readonly segments: readonly string[];
  readonly handler: RouteHandler;
  readonly options: RouteOptions;
}

export function respond(status: number, body: unknown): RouteResponse {
  return { status, body };
}

export const ok = (body: unknown): RouteResponse => respond(200, body);
export const created = (body: unknown): RouteResponse => respond(201, body);
export const noContent = (): RouteResponse => respond(204, null);

/**
 * Small method + path-pattern router over `node:http`. Patterns use `:name` segments,
 * e.g. `/identity/users/:userId/sessions`. Authentication and the declarative permission
 * check happen here so no handler can forget them.
 */
export class Router {
  private readonly routes: RouteEntry[] = [];

  constructor(
    private readonly authentication: AuthenticationService,
    private readonly authorization: AuthorizationService,
  ) {}

  get(pattern: string, handler: RouteHandler, options: RouteOptions = {}): this {
    return this.add("GET", pattern, handler, options);
  }

  post(pattern: string, handler: RouteHandler, options: RouteOptions = {}): this {
    return this.add("POST", pattern, handler, options);
  }

  patch(pattern: string, handler: RouteHandler, options: RouteOptions = {}): this {
    return this.add("PATCH", pattern, handler, options);
  }

  put(pattern: string, handler: RouteHandler, options: RouteOptions = {}): this {
    return this.add("PUT", pattern, handler, options);
  }

  delete(pattern: string, handler: RouteHandler, options: RouteOptions = {}): this {
    return this.add("DELETE", pattern, handler, options);
  }

  routeTable(): readonly { method: string; pattern: string; permission?: string }[] {
    return this.routes.map((route) => ({
      method: route.method,
      pattern: route.pattern,
      permission: route.options.permission,
    }));
  }

  /** node:http request listener. */
  handler(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
    return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
      try {
        const response = await this.dispatch(req);
        if (response.status === 204) {
          res.writeHead(204).end();
          return;
        }
        sendJson(res, response.status, response.body);
      } catch (error) {
        sendError(res, error);
      }
    };
  }

  /** Exposed for tests so routes can be exercised without opening a socket. */
  async dispatch(req: IncomingMessage): Promise<RouteResponse> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathSegments = url.pathname.split("/").filter((segment) => segment.length > 0);
    const match = this.match(req.method ?? "GET", pathSegments);
    if (!match) throw new NotFoundError("Route", `${req.method} ${url.pathname}`);

    const body =
      req.method === "GET" || req.method === "DELETE" ? {} : await readJsonBody(req);

    if (match.entry.options.public) {
      return match.entry.handler({
        principal: undefined as unknown as Principal,
        params: match.params,
        query: url.searchParams,
        body,
        correlationId: "req_public" as Ulid,
      });
    }

    const identity = identifyRequest(req, this.authentication);
    const { permission, scopeFrom } = match.entry.options;
    if (permission) {
      const scope =
        (scopeFrom ? match.params[scopeFrom] : undefined) ?? url.searchParams.get("scope") ?? undefined;
      this.authorization.require(identity.principal, permission, {
        scope,
        correlationId: identity.correlationId,
      });
    }

    return match.entry.handler({
      principal: identity.principal,
      params: match.params,
      query: url.searchParams,
      body,
      correlationId: identity.correlationId,
      ip: identity.ip,
    });
  }

  private add(
    method: string,
    pattern: string,
    handler: RouteHandler,
    options: RouteOptions,
  ): this {
    this.routes.push({
      method,
      pattern,
      segments: pattern.split("/").filter((segment) => segment.length > 0),
      handler,
      options,
    });
    return this;
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
        const segment = entry.segments[i];
        if (segment.startsWith(":")) {
          params[segment.slice(1)] = decodeURIComponent(pathSegments[i]);
        } else if (segment !== pathSegments[i]) {
          matched = false;
          break;
        }
      }
      if (matched) return { entry, params };
    }
    return undefined;
  }
}

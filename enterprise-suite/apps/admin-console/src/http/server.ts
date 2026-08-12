import { createServer, type Server } from "node:http";
import {
  accessLog,
  ANONYMOUS_CONTEXT_TENANT,
  cors,
  errorHandler,
  html,
  json,
  Router,
  tenantContextMiddleware,
  text,
  type HttpRequest,
  type Logger,
} from "@enterprise-suite/api-gateway";
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import type { Permission } from "../domain/role.js";
import type { AdminContainer } from "../infrastructure/container.js";
import { requirePermissions } from "./context.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerFeatureFlagRoutes } from "./routes/feature-flags.js";
import { registerReferenceDataRoutes } from "./routes/reference-data.js";
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerWebhookRoutes } from "./routes/webhooks.js";
import { renderShell } from "./ui.js";

/**
 * The admin console process.
 *
 * The JSON API lives under `basePath` so the whole app can sit behind the
 * gateway's `/api/*` proxy unchanged; the operational endpoints (`/health`,
 * `/health/ready`) stay at the root where probes expect them. The admin shell
 * is served from `/` and calls the same API as any other client.
 */

export const ADMIN_BASE_PATH = "/api/admin";
export const ADMIN_VERSION = "0.1.0";

/** Keeps tests quiet without making the access log optional at the seam. */
const SILENT_LOGGER: Logger = { log: () => undefined };

/**
 * The permission surface of the app, declared in one place.
 *
 * Handlers do not check permissions themselves: `requirePermissions` guards by
 * route name before the handler runs, so this table is the authoritative answer
 * to "what does a caller need in order to do X". A route absent from the table
 * is unguarded and must be listed in {@link PUBLIC_ROUTES} deliberately.
 */
export const ROUTE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  "tenants.list": ["tenant:read"],
  "tenants.create": ["tenant:write"],
  "tenants.get": ["tenant:read"],
  "tenants.update": ["tenant:write"],
  "tenants.activate": ["tenant:admin"],
  "tenants.suspend": ["tenant:admin"],
  "tenants.archive": ["tenant:delete"],
  "tenants.change-plan": ["tenant:admin"],
  "tenants.set-contact": ["tenant:write"],
  "tenants.quotas": ["tenant:read"],
  "tenants.overview": ["tenant:read"],

  "users.list": ["user:read"],
  "users.create": ["user:write"],
  "users.get": ["user:read"],
  "users.update": ["user:write"],
  "users.delete": ["user:delete"],
  "users.assign-roles": ["user:write", "role:read"],
  "users.reissue-invite": ["user:write"],
  "users.suspend": ["user:write"],
  "users.reinstate": ["user:write"],

  "roles.list": ["role:read"],
  "roles.create": ["role:write"],
  "roles.get": ["role:read"],
  "roles.update": ["role:write"],
  "roles.delete": ["role:delete"],
  "roles.clone": ["role:write"],

  "reference-data.list": ["reference-data:read"],
  "reference-data.create": ["reference-data:write"],
  "reference-data.get": ["reference-data:read"],
  "reference-data.update": ["reference-data:write"],
  "reference-data.delete": ["reference-data:delete"],
  "reference-data.publish": ["reference-data:admin"],
  "reference-data.add-entry": ["reference-data:write"],
  "reference-data.update-entry": ["reference-data:write"],
  "reference-data.retire-entry": ["reference-data:write"],
  "reference-data.labels": ["reference-data:read"],

  "webhooks.list": ["webhook:read"],
  "webhooks.create": ["webhook:write"],
  "webhooks.get": ["webhook:read"],
  "webhooks.update": ["webhook:write"],
  "webhooks.delete": ["webhook:delete"],
  "webhooks.pause": ["webhook:write"],
  "webhooks.resume": ["webhook:write"],
  "webhooks.rotate-secret": ["webhook:admin"],
  "webhooks.test": ["webhook:write"],
  "webhooks.deliveries": ["webhook:read"],
  "webhooks.dead-letters": ["webhook:read"],
  "webhooks.drain": ["webhook:admin"],

  "feature-flags.list": ["feature-flag:read"],
  "feature-flags.create": ["feature-flag:write"],
  "feature-flags.get": ["feature-flag:read"],
  "feature-flags.update": ["feature-flag:write"],
  "feature-flags.delete": ["feature-flag:delete"],
  "feature-flags.upsert-rule": ["feature-flag:write"],
  "feature-flags.remove-rule": ["feature-flag:write"],
  "feature-flags.evaluate": ["feature-flag:read"],
  "feature-flags.explain": ["feature-flag:read"],
  "feature-flags.simulate": ["feature-flag:read"],

  "audit.list": ["audit:read"],
  "audit.summary": ["audit:read"],
  "audit.events": ["audit:read"],
};

/**
 * Routes that carry their own proof of authority. Accepting an invitation is
 * the only one: the caller presents a single-use token and by definition has no
 * role yet, so a permission check would make the invitation unredeemable.
 */
export const PUBLIC_ROUTES: readonly string[] = ["users.accept-invite"];

export interface AdminServerOptions {
  readonly basePath?: string;
  readonly logger?: Logger;
  readonly corsOrigins?: readonly string[];
  /** Values pre-filled in the shell's header. */
  readonly shell?: {
    readonly tenant?: string;
    readonly user?: string;
    readonly roles?: string;
    /** Set false to serve the JSON API only. */
    readonly enabled?: boolean;
  };
}

export function buildAdminRouter(
  container: AdminContainer,
  options: AdminServerOptions = {},
): Router {
  const basePath = options.basePath ?? ADMIN_BASE_PATH;
  const logger = options.logger ?? SILENT_LOGGER;
  const router = new Router({ serviceName: "admin-console" });

  const api = new Router({ serviceName: "admin-console" });
  registerTenantRoutes(api, container);
  registerUserRoutes(api, container);
  registerReferenceDataRoutes(api, container);
  registerWebhookRoutes(api, container);
  registerFeatureFlagRoutes(api, container);
  registerAuditRoutes(api, container);

  router
    .use(errorHandler({ logger, service: "admin-console" }))
    .use(cors({ origins: options.corsOrigins }))
    .use(accessLog({ logger, clock: container.clock }))
    .use(
      tenantContextMiddleware({
        anonymousPaths: [
          "/",
          "/health",
          "/health/*",
          "/ready",
          "/openapi.json",
          "/favicon.ico",
          "/robots.txt",
          `${basePath}/openapi.json`,
        ],
        defaultRoles: [],
      }),
    )
    .use(requirePermissions(container, ROUTE_PERMISSIONS, { publicRoutes: PUBLIC_ROUTES }));

  router.mount(basePath, api);

  const liveness = () =>
    json(200, {
      status: "ok",
      service: "admin-console",
      version: ADMIN_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      checkedAt: container.clock.now(),
    });
  router.get("/health", liveness, "health.live");
  router.get("/health/live", liveness, "health.live");

  // Readiness is a self-check: the console owns its stores, so what matters is
  // that they answer and that the delivery queue is not wedged.
  const readiness = (req: HttpRequest) => {
    const now = container.clock.now();
    const backlogLimit = Number(req.query.get("maxBacklog") ?? 500);
    const tenants = container.repos.tenants.list();
    const backlog = container.repos.deliveries.due(now, backlogLimit + 1).length;
    const deadLetters = tenants.reduce(
      (total, tenant) =>
        total + container.repos.deliveries.list(tenant.tenantId, { status: "dead" }).length,
      0,
    );
    const checks = [
      {
        name: "tenant-store",
        status: "up" as const,
        detail: `${tenants.length} tenants`,
      },
      {
        name: "webhook-queue",
        status: backlog > backlogLimit ? ("degraded" as const) : ("up" as const),
        detail: `${backlog} due, ${deadLetters} dead-lettered`,
      },
    ];
    const degraded = checks.some((check) => check.status === "degraded");
    return json(degraded ? 503 : 200, {
      status: degraded ? "degraded" : "ready",
      service: "admin-console",
      version: ADMIN_VERSION,
      checkedAt: now,
      checks,
    });
  };
  router.get("/health/ready", readiness, "health.ready");
  router.get("/ready", readiness, "health.ready");

  const spec = () => json(200, adminOpenApiDocument(api, basePath));
  router.get("/openapi.json", spec, "openapi.document");
  router.get(`${basePath}/openapi.json`, spec, "openapi.document");

  if (options.shell?.enabled !== false) {
    router.get(
      "/",
      () =>
        html(
          200,
          renderShell({
            basePath,
            version: ADMIN_VERSION,
            defaultTenant: options.shell?.tenant ?? "northwind",
            defaultUser: options.shell?.user ?? "ada@northwind.example",
            defaultRoles: options.shell?.roles ?? "tenant-admin",
          }),
        ),
      "shell.index",
    );
  } else {
    router.get(
      "/",
      () =>
        json(200, {
          service: "admin-console",
          version: ADMIN_VERSION,
          basePath,
          endpoints: ["/health", "/health/ready", "/openapi.json", basePath],
        }),
      "shell.index",
    );
  }

  router.get("/robots.txt", () => text(200, "User-agent: *\nDisallow: /\n"), "shell.robots");

  return router;
}

/**
 * Builds the OpenAPI document from the routes as registered, so the published
 * contract cannot drift from what the router actually serves. Each operation
 * carries the permissions the guard will demand, which is the part a consumer
 * cannot discover by reading paths alone.
 */
export function adminOpenApiDocument(api: Router, basePath: string): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const route of api.export()) {
    const name = route.name ?? route.compiled.source;
    const tag = name.includes(".") ? name.slice(0, name.indexOf(".")) : "admin";
    tags.add(tag);
    const specPath = `${basePath}${route.compiled.source}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
    const parameters = [...route.compiled.source.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => ({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    }));
    const required = ROUTE_PERMISSIONS[name] ?? [];
    const responses: Record<string, unknown> = {
      "200": { description: "Success" },
      "400": { description: "Validation failure" },
      "401": { description: "Missing x-tenant-id or x-user-id" },
      "404": { description: "Resource not found in this tenant" },
    };
    if (required.length > 0) {
      responses["403"] = { description: `Requires [${required.join(", ")}]` };
    }
    if (route.method !== "GET") responses["409"] = { description: "Conflicting state" };

    (paths[specPath] ??= {})[route.method.toLowerCase()] = {
      operationId: name.replace(/[^A-Za-z0-9]+/g, "_"),
      summary: `${route.method} ${route.compiled.source}`,
      tags: [tag],
      parameters: parameters.length > 0 ? parameters : undefined,
      "x-required-permissions": required.length > 0 ? required : undefined,
      responses,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "Admin Console",
      version: ADMIN_VERSION,
      description:
        "Tenant administration: tenants, users and roles, reference data, webhooks and feature flags. " +
        "Every request carries x-tenant-id and x-user-id; x-roles supplies the caller's tenant role codes.",
    },
    servers: [{ url: basePath }],
    tags: [...tags].sort().map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        tenantHeader: { type: "apiKey", in: "header", name: "x-tenant-id" },
        userHeader: { type: "apiKey", in: "header", name: "x-user-id" },
      },
      schemas: {
        Error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            details: { type: "object", additionalProperties: true },
            requestId: { type: "string" },
          },
        },
      },
    },
    security: [{ tenantHeader: [], userHeader: [] }],
  };
}

export function createAdminServer(
  container: AdminContainer,
  options: AdminServerOptions = {},
): Server {
  return createServer(buildAdminRouter(container, options).listener());
}

/** Test helper: drives the router without opening a socket. */
export async function callAdmin(
  router: Router,
  method: string,
  path: string,
  options: {
    body?: unknown;
    tenant?: string;
    user?: string;
    roles?: readonly string[];
    headers?: Record<string, string>;
  } = {},
): Promise<{ status: number; body: any; headers: Record<string, string> }> {
  const url = new URL(path, "http://admin.local");
  const headers: Record<string, string> = { ...options.headers };
  if (options.tenant !== undefined) headers["x-tenant-id"] = options.tenant;
  if (options.user !== undefined) headers["x-user-id"] = options.user;
  if (options.roles !== undefined) headers["x-roles"] = options.roles.join(",");

  const response = await router.handle({
    method,
    path: url.pathname,
    params: {},
    query: url.searchParams,
    headers,
    body: options.body,
    rawUrl: path,
    // Replaced by the tenant middleware; present so the error handler can read
    // a request id even when that middleware is the thing that throws.
    ctx: createTenantContext(ANONYMOUS_CONTEXT_TENANT, ANONYMOUS_CONTEXT_TENANT, []),
    locals: {},
  });
  return {
    status: response.status,
    body: response.raw !== undefined ? response.raw : response.body,
    headers: { ...(response.headers ?? {}) },
  };
}

import { DomainError } from "@enterprise-suite/shared-kernel";
import type { ListQuery } from "../../api/types.js";
import { buildNavigation } from "../../domain/navigation.js";
import type { PortalContainer } from "../../infrastructure/container.js";
import { requireSession } from "../context.js";
import { json, Router, type PortalRequest } from "../router.js";

/**
 * JSON backend-for-frontend.
 *
 * Same services as the server-rendered pages, so a future SPA or a native
 * client sees identical permission filtering and identical degraded states.
 */
export function registerBffRoutes(router: Router, container: PortalContainer): void {
  router.get("/api/nav", async (req) => {
    const session = requireSession(req);
    const preferences = await container.preferences.load(session);
    return json(200, {
      modules: buildNavigation(session, {
        activePath: req.query.get("path") ?? undefined,
        pinned: preferences.pinnedModules,
      }),
      pinned: preferences.pinnedModules,
      landingModule: preferences.landingModule,
    });
  });

  router.get("/api/dashboard", async (req) => {
    const session = requireSession(req);
    const dashboard = await container.forSession(session).dashboard.load(session);
    return json(200, dashboard);
  });

  router.get("/api/search", async (req) => {
    const session = requireSession(req);
    const result = await container
      .forSession(session)
      .search.search(session, req.query.get("q") ?? "", {
        perModuleLimit: intParam(req.query.get("limit")) ?? 5,
      });
    return json(200, result);
  });

  router.get("/api/modules/:module/:slug", async (req) => {
    const session = requireSession(req);
    const view = await container
      .forSession(session)
      .modules.loadList(session, req.params.module ?? "", req.params.slug ?? "", listQuery(req));
    return json(200, view);
  });

  router.post("/api/modules/:module/actions/:action", async (req) => {
    const session = requireSession(req);
    const result = await container
      .forSession(session)
      .modules.runAction(
        session,
        req.params.module ?? "",
        req.params.action ?? "",
        req.body ?? {},
        req.headers["idempotency-key"],
      );
    return json(202, { accepted: true, result });
  });

  router.get("/api/preferences", async (req) => {
    const session = requireSession(req);
    return json(200, await container.preferences.load(session));
  });

  router.patch("/api/preferences", async (req) => {
    const session = requireSession(req);
    const body = req.body;
    if (body !== undefined && (typeof body !== "object" || body === null)) {
      throw new DomainError("Body must be an object", "VALIDATION", 400);
    }
    const patch = (body ?? {}) as Record<string, unknown>;
    return json(
      200,
      await container.preferences.update(session, {
        pinnedModules: Array.isArray(patch.pinnedModules)
          ? patch.pinnedModules.map(String)
          : undefined,
        landingModule:
          patch.landingModule === null ? null : optionalString(patch.landingModule),
        density: optionalString(patch.density),
        theme: optionalString(patch.theme),
        locale: optionalString(patch.locale),
      }),
    );
  });

  router.post("/api/preferences/pins/:module", async (req) => {
    const session = requireSession(req);
    return json(200, await container.preferences.togglePinned(session, req.params.module ?? ""));
  });

  router.post("/api/preferences/views", async (req) => {
    const session = requireSession(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const module = optionalString(body.module);
    const resource = optionalString(body.resource);
    const name = optionalString(body.name);
    if (!module || !resource || !name) {
      throw new DomainError("module, resource and name are required", "VALIDATION", 400);
    }
    return json(
      201,
      await container.preferences.saveView(session, {
        module,
        resource,
        name,
        query: isRecord(body.query) ? mapToStrings(body.query) : {},
      }),
    );
  });

  router.delete("/api/preferences/views/:id", async (req) => {
    const session = requireSession(req);
    return json(200, await container.preferences.deleteView(session, req.params.id ?? ""));
  });

  router.get("/api/diagnostics", (req) => {
    const session = requireSession(req);
    session.permissions.require("*");
    return json(200, {
      transport: container.config.transport,
      endpoints: container.config.endpoints,
      services: container.callLog.summary(),
      recentCalls: container.callLog.recent(25),
    });
  });
}

function listQuery(req: PortalRequest): ListQuery {
  const query: { -readonly [K in keyof ListQuery]: ListQuery[K] } = {};
  const page = intParam(req.query.get("page"));
  const pageSize = intParam(req.query.get("pageSize"));
  if (page !== undefined) query.page = page;
  if (pageSize !== undefined) query.pageSize = pageSize;
  const q = req.query.get("q");
  if (q) query.q = q;
  const sort = req.query.get("sort");
  if (sort) query.sort = sort;
  return query;
}

function intParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapToStrings(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, String(val)]));
}

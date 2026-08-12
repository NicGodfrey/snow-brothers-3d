import { DomainError } from "@enterprise-suite/shared-kernel";
import type { ListQuery } from "../../api/types.js";
import { defaultNavItem, navItemPath } from "../../domain/module.js";
import { tryGetModule } from "../../domain/module-catalog.js";
import type { PortalContainer } from "../../infrastructure/container.js";
import { pageContext, signInRedirect } from "../context.js";
import { htmlResponse, redirect, Router, type PortalRequest, type PortalResponse } from "../router.js";
import { renderPage } from "../views/layout.js";
import { dashboardPage } from "../views/pages/dashboard.js";
import { errorPage } from "../views/pages/error.js";
import { moduleListPage } from "../views/pages/module-list.js";
import { preferencesPage } from "../views/pages/preferences.js";
import { profilePage } from "../views/pages/profile.js";
import { searchPage } from "../views/pages/search.js";

/** Server-rendered screens. Every one of them works without JavaScript. */
export function registerShellRoutes(router: Router, container: PortalContainer): void {
  const guard =
    (handler: (req: PortalRequest) => Promise<PortalResponse>) =>
    async (req: PortalRequest): Promise<PortalResponse> => {
      if (!req.session) return redirect(signInRedirect(req));
      return handler(req);
    };

  router.get(
    "/",
    guard(async (req) => {
      const ctx = await pageContext(container, req);
      const dashboard = await ctx.scope.dashboard.load(ctx.session);
      return htmlResponse(
        200,
        renderPage({
          title: "Overview",
          shell: ctx.shell,
          counts: dashboard.counts,
          content: dashboardPage({
            shell: ctx.shell,
            dashboard,
            preferences: ctx.preferences,
            locale: ctx.locale,
          }),
        }),
      );
    }),
  );

  router.get(
    "/m/:module",
    guard(async (req) => {
      const module = tryGetModule(req.params.module ?? "");
      if (!module) return notFoundPage(container, req);
      return redirect(navItemPath(module, defaultNavItem(module)));
    }),
  );

  router.get(
    "/m/:module/:slug",
    guard(async (req) => {
      const ctx = await pageContext(container, req);
      const moduleKey = req.params.module ?? "";
      const slug = req.params.slug ?? "";
      try {
        const [view, counts] = await Promise.all([
          ctx.scope.modules.loadList(ctx.session, moduleKey, slug, listQuery(req)),
          countsFor(container, req, moduleKey),
        ]);
        return htmlResponse(
          200,
          renderPage({
            title: `${view.moduleLabel} · ${view.item.label}`,
            shell: ctx.shell,
            counts,
            content: moduleListPage({ shell: ctx.shell, view }),
          }),
        );
      } catch (error) {
        return renderDomainError(container, req, error);
      }
    }),
  );

  router.post(
    "/m/:module/actions/:action",
    guard(async (req) => {
      const ctx = await pageContext(container, req);
      const moduleKey = req.params.module ?? "";
      await ctx.scope.modules.runAction(
        ctx.session,
        moduleKey,
        req.params.action ?? "",
        req.body ?? {},
        req.headers["idempotency-key"],
      );
      const module = tryGetModule(moduleKey);
      const back = module ? navItemPath(module, defaultNavItem(module)) : "/";
      return redirect(`${back}?submitted=1`);
    }),
  );

  router.get(
    "/search",
    guard(async (req) => {
      const ctx = await pageContext(container, req);
      const result = await ctx.scope.search.search(ctx.session, req.query.get("q") ?? "");
      return htmlResponse(
        200,
        renderPage({
          title: "Search",
          shell: ctx.shell,
          content: searchPage({ shell: ctx.shell, result }),
        }),
      );
    }),
  );

  router.get(
    "/profile",
    guard(async (req) => {
      const ctx = await pageContext(container, req);
      return htmlResponse(
        200,
        renderPage({
          title: "Profile",
          shell: ctx.shell,
          content: profilePage({ shell: ctx.shell, session: ctx.session }),
        }),
      );
    }),
  );

  router.get(
    "/preferences",
    guard(async (req) => {
      const ctx = await pageContext(container, req);
      return htmlResponse(
        200,
        renderPage({
          title: "Preferences",
          shell: ctx.shell,
          content: preferencesPage({
            shell: ctx.shell,
            preferences: ctx.preferences,
            modules: ctx.shell.nav,
            saved: req.query.get("saved") === "1",
          }),
        }),
      );
    }),
  );

  router.post(
    "/preferences",
    guard(async (req) => {
      const ctx = await pageContext(container, req, "/preferences");
      const body = asRecord(req.body);
      await container.preferences.update(ctx.session, {
        density: optional(body.density),
        theme: optional(body.theme),
        locale: optional(body.locale),
        landingModule: body.landingModule === "" ? null : optional(body.landingModule),
      });
      return redirect("/preferences?saved=1");
    }),
  );

  router.post(
    "/preferences/pins/:module",
    guard(async (req) => {
      const ctx = await pageContext(container, req, "/preferences");
      await container.preferences.togglePinned(ctx.session, req.params.module ?? "");
      return redirect("/preferences?saved=1");
    }),
  );

  router.post(
    "/preferences/views",
    guard(async (req) => {
      const ctx = await pageContext(container, req, "/preferences");
      const body = asRecord(req.body);
      const module = optional(body.module);
      const resource = optional(body.resource);
      const name = optional(body.name);
      if (!module || !resource || !name) {
        throw new DomainError("module, resource and name are required", "VALIDATION", 400);
      }
      const q = optional(body.q);
      await container.preferences.saveView(ctx.session, {
        module,
        resource,
        name,
        query: q ? { q } : {},
      });
      return redirect(`/m/${module}/${resource}`);
    }),
  );

  router.post(
    "/preferences/views/:id/delete",
    guard(async (req) => {
      const ctx = await pageContext(container, req, "/preferences");
      await container.preferences.deleteView(ctx.session, req.params.id ?? "");
      return redirect("/preferences?saved=1");
    }),
  );
}

function listQuery(req: PortalRequest): ListQuery {
  const query: { -readonly [K in keyof ListQuery]: ListQuery[K] } = {};
  const page = Number.parseInt(req.query.get("page") ?? "", 10);
  const pageSize = Number.parseInt(req.query.get("pageSize") ?? "", 10);
  if (Number.isFinite(page)) query.page = page;
  if (Number.isFinite(pageSize)) query.pageSize = pageSize;
  const q = req.query.get("q");
  if (q) query.q = q;
  const sort = req.query.get("sort");
  if (sort) query.sort = sort;
  return query;
}

async function countsFor(
  container: PortalContainer,
  req: PortalRequest,
  moduleKey: string,
): Promise<Readonly<Record<string, number>>> {
  const module = tryGetModule(moduleKey);
  if (!module || !req.session) return {};
  return container.forSession(req.session).dashboard.counts(module.key);
}

async function notFoundPage(
  container: PortalContainer,
  req: PortalRequest,
): Promise<PortalResponse> {
  return renderDomainError(
    container,
    req,
    new DomainError(`No such page: ${req.path}`, "NOT_FOUND", 404),
  );
}

async function renderDomainError(
  container: PortalContainer,
  req: PortalRequest,
  error: unknown,
): Promise<PortalResponse> {
  if (!(error instanceof DomainError)) throw error;
  const ctx = await pageContext(container, req);
  return htmlResponse(
    error.status,
    renderPage({
      title: `${error.status}`,
      shell: ctx.shell,
      content: errorPage({
        shell: ctx.shell,
        status: error.status,
        code: error.code,
        message: error.message,
      }),
    }),
  );
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function optional(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

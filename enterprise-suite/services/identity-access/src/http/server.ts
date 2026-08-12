import { createServer, type Server } from "node:http";
import type { IdentityModule } from "../infrastructure/container.js";
import { Router, ok } from "./router.js";
import { registerApiKeyRoutes } from "./routes/api-keys.js";
import { registerAuditRoutes } from "./routes/audit.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAuthzRoutes } from "./routes/authz.js";
import { registerBindingRoutes } from "./routes/bindings.js";
import { registerGroupRoutes } from "./routes/groups.js";
import { registerRoleRoutes } from "./routes/roles.js";
import { registerTenantRoutes } from "./routes/tenants.js";
import { registerUserRoutes } from "./routes/users.js";

export function createIdentityRouter(module: IdentityModule): Router {
  const router = new Router(module.authentication, module.authorization);

  router.get("/health", () => ok({ status: "ok", service: "identity-access" }), { public: true });
  router.get(
    "/health/ready",
    () =>
      ok({
        status: "ok",
        tenants: module.repositories.tenants.list().length,
        permissions: module.catalog.size,
        pendingEvents: module.outbox.size(),
      }),
    { public: true },
  );
  router.get("/identity/routes", () => ok(router.routeTable()), { public: true });

  registerAuthRoutes(router, module);
  registerTenantRoutes(router, module);
  registerUserRoutes(router, module);
  registerGroupRoutes(router, module);
  registerRoleRoutes(router, module);
  registerBindingRoutes(router, module);
  registerApiKeyRoutes(router, module);
  registerAuthzRoutes(router, module);
  registerAuditRoutes(router, module);

  return router;
}

export function createIdentityServer(module: IdentityModule): Server {
  return createServer(createIdentityRouter(module).handler());
}

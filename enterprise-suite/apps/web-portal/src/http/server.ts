import { createServer, type Server } from "node:http";
import type { PortalSession } from "../domain/session.js";
import type { PortalContainer } from "../infrastructure/container.js";
import { bearerToken, SESSION_COOKIE } from "./cookies.js";
import { json, Router } from "./router.js";
import { registerAssetRoutes } from "./routes/asset-routes.js";
import { registerAuthRoutes } from "./routes/auth-routes.js";
import { registerBffRoutes } from "./routes/bff-routes.js";
import { registerShellRoutes } from "./routes/shell-routes.js";

/**
 * Wires the router.
 *
 * Session resolution order: `Authorization: Bearer`, cookie, then explicitly
 * trusted development headers. A supplied but invalid token fails closed and
 * is never allowed to fall back to spoofable role headers.
 */
export function buildRouter(container: PortalContainer): Router {
  const router = new Router({
    resolveSession(headers, cookies): PortalSession | undefined {
      const token = bearerToken(headers.authorization) ?? cookies[SESSION_COOKIE];
      if (token) return container.auth.sessionFromToken(token);
      return container.auth.sessionFromHeaders(headers);
    },
    onError(error, req) {
      const status = (error as { status?: number }).status;
      if (status === undefined || status >= 500) {
        // eslint-disable-next-line no-console
        console.error(`[web-portal] ${req.method} ${req.path} failed`, error);
      }
    },
  });

  router.get("/health", () =>
    json(200, {
      status: "ok",
      service: "web-portal",
      transport: container.config.transport,
      time: container.clock.now(),
    }),
  );

  registerAssetRoutes(router);
  registerAuthRoutes(router, container);
  registerBffRoutes(router, container);
  registerShellRoutes(router, container);
  return router;
}

export function createPortalServer(container: PortalContainer): Server {
  return createServer(buildRouter(container).listener());
}

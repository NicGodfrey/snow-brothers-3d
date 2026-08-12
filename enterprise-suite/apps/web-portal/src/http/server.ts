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
 * Session resolution order: cookie, then `Authorization: Bearer`, then the
 * gateway headers. A bad cookie or token yields an anonymous request (the
 * shell redirects to sign-in); bad *headers* raise, because a caller that
 * asserts an identity should be told the assertion was rejected.
 */
export function buildRouter(container: PortalContainer): Router {
  const router = new Router({
    resolveSession(headers, cookies): PortalSession | undefined {
      const token = cookies[SESSION_COOKIE] ?? bearerToken(headers.authorization);
      if (token) {
        try {
          return container.auth.sessionFromToken(token);
        } catch {
          return container.auth.sessionFromHeaders(headers);
        }
      }
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

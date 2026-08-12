import { createServer, type Server } from "node:http";
import type { PlmContainer } from "../infrastructure/container.js";
import { jsonResponse, Router } from "./router.js";
import { registerBomRoutes } from "./routes/bom-routes.js";
import { registerCatalogRoutes } from "./routes/catalog-routes.js";
import { registerEcoRoutes } from "./routes/eco-routes.js";
import { registerProductRoutes } from "./routes/product-routes.js";

export function buildRouter(container: PlmContainer): Router {
  const router = new Router();

  router.get("/health", () => jsonResponse(200, { status: "ok", service: "product-plm" }));

  // Demo/diagnostics: the tenant's event log from the in-memory outbox.
  router.get("/events", (req) => {
    const type = req.query.get("type");
    const events = container.outbox
      .entries(req.ctx.tenantId)
      .filter((e) => (type ? e.eventType === type : true));
    return jsonResponse(200, events);
  });

  registerCatalogRoutes(router, container);
  registerProductRoutes(router, container);
  registerBomRoutes(router, container);
  registerEcoRoutes(router, container);
  return router;
}

export function createPlmServer(container: PlmContainer): Server {
  return createServer(buildRouter(container).listener());
}

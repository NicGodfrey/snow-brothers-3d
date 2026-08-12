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

  // Outbox integration endpoints for the suite outbox-relay (integration-hub).
  // The log is append-only and retained for /events diagnostics; the drain is
  // a cursor over it so each call hands out only what is new.
  let relayCursor = 0;
  router.get("/outbox/pending", () =>
    jsonResponse(200, { items: container.outbox.entries().slice(relayCursor) }),
  );
  router.post("/outbox/drain", () => {
    const items = container.outbox.entries().slice(relayCursor);
    relayCursor += items.length;
    return jsonResponse(200, { count: items.length, items });
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

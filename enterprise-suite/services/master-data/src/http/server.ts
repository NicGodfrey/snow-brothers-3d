import { createServer, type Server } from "node:http";
import type { MasterDataContainer } from "../infrastructure/container.js";
import { jsonResponse, Router } from "./router.js";
import { registerCodeListRoutes } from "./routes/code-list-routes.js";
import { registerCustomerRoutes } from "./routes/customer-routes.js";
import { registerMoneyRoutes } from "./routes/money-routes.js";
import { registerReferenceRoutes } from "./routes/reference-routes.js";
import { registerSiteRoutes } from "./routes/site-routes.js";
import { registerTermRoutes } from "./routes/terms-routes.js";
import { registerUomRoutes } from "./routes/uom-routes.js";

export function buildRouter(container: MasterDataContainer): Router {
  const router = new Router();

  router.get("/health", () => jsonResponse(200, { status: "ok", service: "master-data" }));

  // Diagnostics: the tenant's slice of the in-memory outbox log.
  router.get("/events", (req) => {
    const type = req.query.get("type");
    const aggregate = req.query.get("aggregateType");
    const events = container.outbox
      .entries(req.ctx.tenantId)
      .filter((event) => (type ? event.eventType === type : true))
      .filter((event) => (aggregate ? event.aggregateType === aggregate : true));
    return jsonResponse(200, events);
  });

  registerReferenceRoutes(router, container);
  registerMoneyRoutes(router, container);
  registerUomRoutes(router, container);
  registerTermRoutes(router, container);
  registerCodeListRoutes(router, container);
  registerCustomerRoutes(router, container);
  registerSiteRoutes(router, container);
  return router;
}

export function createMasterDataServer(container: MasterDataContainer): Server {
  return createServer(buildRouter(container).listener());
}

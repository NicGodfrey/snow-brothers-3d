import { createServer, type Server } from "node:http";
import type { PrmContainer } from "../infrastructure/container.js";
import { jsonResponse, Router } from "./router.js";
import { registerContractRoutes } from "./routes/contract-routes.js";
import { registerMdfRoutes } from "./routes/mdf-routes.js";
import { registerPartnerRoutes } from "./routes/partner-routes.js";
import { registerPortalRoutes } from "./routes/portal-routes.js";
import { registerTierRoutes } from "./routes/tier-routes.js";
import { registerTrainingRoutes } from "./routes/training-routes.js";

export function buildRouter(container: PrmContainer): Router {
  const router = new Router();

  router.get("/health", () => jsonResponse(200, { status: "ok", service: "prm-core" }));

  // Demo/diagnostics: the tenant's event log from the in-memory outbox.
  router.get("/events", (req) => {
    const type = req.query.get("type");
    const aggregateId = req.query.get("aggregateId");
    const events = container.outbox
      .entries(req.ctx.tenantId)
      .filter((e) => (type ? e.eventType === type : true))
      .filter((e) => (aggregateId ? e.aggregateId === aggregateId : true));
    return jsonResponse(200, events);
  });

  registerPartnerRoutes(router, container);
  registerTierRoutes(router, container);
  registerContractRoutes(router, container);
  registerMdfRoutes(router, container);
  registerTrainingRoutes(router, container);
  registerPortalRoutes(router, container);
  return router;
}

export function createPrmServer(container: PrmContainer): Server {
  return createServer(buildRouter(container).listener());
}

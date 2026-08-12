import { createServer, type Server } from "node:http";
import type { SrmContainer } from "../infrastructure/container.js";
import { jsonResponse, Router } from "./router.js";
import { registerCategoryRoutes } from "./routes/category-routes.js";
import { registerContractRoutes } from "./routes/contract-routes.js";
import { registerOnboardingRoutes } from "./routes/onboarding-routes.js";
import { registerPerformanceRoutes } from "./routes/performance-routes.js";
import { registerQualificationRoutes } from "./routes/qualification-routes.js";
import { registerRiskRoutes } from "./routes/risk-routes.js";
import { registerSupplierRoutes } from "./routes/supplier-routes.js";

export function buildRouter(container: SrmContainer): Router {
  const router = new Router();

  router.get("/health", () => jsonResponse(200, { status: "ok", service: "srm-core" }));

  // Demo/diagnostics: the tenant's event log from the in-memory outbox.
  router.get("/events", (req) => {
    const type = req.query.get("type");
    const aggregateId = req.query.get("aggregateId");
    const events = container.outbox
      .entries(req.ctx.tenantId)
      .filter((event) => (type ? event.eventType === type : true))
      .filter((event) => (aggregateId ? event.aggregateId === aggregateId : true));
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

  registerCategoryRoutes(router, container);
  registerSupplierRoutes(router, container);
  registerOnboardingRoutes(router, container);
  registerQualificationRoutes(router, container);
  registerPerformanceRoutes(router, container);
  registerContractRoutes(router, container);
  registerRiskRoutes(router, container);
  return router;
}

export function createSrmServer(container: SrmContainer): Server {
  return createServer(buildRouter(container).listener());
}

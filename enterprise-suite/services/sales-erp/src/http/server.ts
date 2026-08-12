import { createServer, type Server } from "node:http";
import type { SalesModule } from "../infrastructure/container.js";
import { Router, respond } from "./router.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import { registerOpportunityRoutes } from "./routes/opportunities.js";
import { registerPriceListRoutes } from "./routes/price-lists.js";
import { registerQuoteRoutes } from "./routes/quotes.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerReturnRoutes } from "./routes/returns.js";

export function buildRouter(module: SalesModule): Router {
  const router = new Router();

  router.get("/health", () => respond(200, { status: "ok", service: "sales-erp" }), {
    public: true,
  });

  /** Debug view of the in-memory outbox (integration/event verification). */
  router.get("/sales/outbox", ({ ctx }) =>
    respond(200, {
      events: module.outbox.all().filter((e) => e.tenantId === ctx.tenantId),
    }),
  );

  // Outbox integration endpoints for the suite outbox-relay (integration-hub).
  router.get("/outbox/pending", () => respond(200, { items: module.outbox.all() }));
  router.post("/outbox/drain", () => {
    const events = module.outbox.drain();
    return respond(200, { count: events.length, items: events });
  });

  registerAccountRoutes(router, module);
  registerOpportunityRoutes(router, module);
  registerPriceListRoutes(router, module);
  registerQuoteRoutes(router, module);
  registerOrderRoutes(router, module);
  registerReturnRoutes(router, module);
  return router;
}

export function buildServer(module: SalesModule): Server {
  return createServer(buildRouter(module).handler());
}

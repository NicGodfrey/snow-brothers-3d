/**
 * HTTP server assembly: exposes the whole integration-hub API over
 * node:http on top of an IntegrationHubModule.
 */
import { createServer, type Server } from "node:http";
import type { IntegrationHubModule } from "../infrastructure/module.js";
import { Router } from "./router.js";
import { registerAdapterRoutes } from "./routes/adapter-routes.js";
import { registerDeliveryRoutes } from "./routes/delivery-routes.js";
import { registerIdempotencyRoutes } from "./routes/idempotency-routes.js";
import { registerInboxRoutes } from "./routes/inbox-routes.js";
import { registerOutboxRoutes } from "./routes/outbox-routes.js";
import { registerRouteRuleRoutes } from "./routes/route-rule-routes.js";
import { registerWebhookRoutes } from "./routes/webhook-routes.js";

export function buildRouter(module: IntegrationHubModule): Router {
  const router = new Router();

  router.get("/health", () => ({
    body: { status: "ok", service: "integration-hub", time: module.clock.now() },
  }));

  /** Bus counters plus queue depths — what an operator dashboard polls. */
  router.get("/metrics", async ({ ctx }) => ({
    body: {
      bus: module.bus.metrics(),
      outbox: await module.repos.outbox.countsByStatus(ctx.tenantId),
      inbox: await module.repos.inbox.countsByStatus(ctx.tenantId),
      deliveries: await module.repos.deliveries.countsByStatus(ctx.tenantId),
      deadLetters: module.bus.deadLetters.size,
    },
  }));

  registerOutboxRoutes(router, module.services.outbox, module.services.relay);
  registerInboxRoutes(router, module.services.inbox);
  registerIdempotencyRoutes(router, module.services.idempotency);
  registerWebhookRoutes(router, module.services.webhooks, module.services.deliveries);
  registerDeliveryRoutes(router, module.services.deliveries);
  registerAdapterRoutes(router, module.services.adapters);
  registerRouteRuleRoutes(router, module.services.routing);

  return router;
}

export function createIntegrationHubServer(module: IntegrationHubModule): Server {
  const router = buildRouter(module);
  return createServer((req, res) => {
    void router.dispatch(req, res);
  });
}

import { createServer, type Server } from "node:http";
import type { ChannelContainer } from "../infrastructure/container.js";
import { jsonResponse, Router } from "./router.js";
import { registerAnalyticsRoutes } from "./routes/analytics-routes.js";
import { registerCommerceRoutes } from "./routes/commerce-routes.js";
import { registerConflictRoutes } from "./routes/conflict-routes.js";
import { registerPartnerRoutes } from "./routes/partner-routes.js";
import { registerReferralRoutes } from "./routes/referral-routes.js";
import { registerRegistrationRoutes } from "./routes/registration-routes.js";

export function buildRouter(container: ChannelContainer): Router {
  const router = new Router();

  router.get("/health", () => jsonResponse(200, { status: "ok", service: "channel-prm" }));

  // Diagnostics: the tenant's event stream out of the in-memory outbox.
  router.get("/events", (req) => {
    const type = req.query.get("type");
    const events = container.outbox
      .entries(req.ctx.tenantId)
      .filter((event) => (type ? event.eventType === type : true));
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

  registerPartnerRoutes(router, container);
  registerRegistrationRoutes(router, container);
  registerReferralRoutes(router, container);
  registerCommerceRoutes(router, container);
  registerConflictRoutes(router, container);
  registerAnalyticsRoutes(router, container);
  return router;
}

export function createChannelServer(container: ChannelContainer): Server {
  return createServer(buildRouter(container).listener());
}

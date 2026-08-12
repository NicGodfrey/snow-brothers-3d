import type { ProcurementModule } from "../module.js";
import { jsonOk, Router } from "./router.js";
import { registerAgreementRoutes } from "./routes/agreement-routes.js";
import { registerAnalyticsRoutes } from "./routes/analytics-routes.js";
import { registerApprovalRoutes } from "./routes/approval-routes.js";
import { registerInvoiceRoutes } from "./routes/invoice-routes.js";
import { registerPurchaseOrderRoutes } from "./routes/purchase-order-routes.js";
import { registerReceiptRoutes } from "./routes/receipt-routes.js";
import { registerRequisitionRoutes } from "./routes/requisition-routes.js";
import { registerSourcingRoutes } from "./routes/sourcing-routes.js";
import { registerSupplierRoutes } from "./routes/supplier-routes.js";

/** Wires every procurement route group onto a single router. */
export function buildProcurementRouter(module: ProcurementModule): Router {
  const router = new Router();

  router.get("/health", () => jsonOk({ status: "ok", service: "procurement-srm" }));
  router.get("/routes", () => jsonOk({ items: router.describe() }));

  // Outbox integration endpoints for the event dispatcher (integration-hub).
  router.get("/outbox", () => jsonOk({ items: module.outbox.peek() }));
  router.post("/outbox/drain", () => {
    const events = module.outbox.drain();
    return jsonOk({ count: events.length, items: events });
  });

  registerSupplierRoutes(router, module);
  registerRequisitionRoutes(router, module);
  registerApprovalRoutes(router, module);
  registerSourcingRoutes(router, module);
  registerPurchaseOrderRoutes(router, module);
  registerReceiptRoutes(router, module);
  registerInvoiceRoutes(router, module);
  registerAgreementRoutes(router, module);
  registerAnalyticsRoutes(router, module);

  return router;
}

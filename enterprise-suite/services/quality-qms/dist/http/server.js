/**
 * HTTP server assembly: builds a node:http server exposing the full
 * quality-qms API on top of a QualityQmsModule.
 */
import { createServer } from "node:http";
import { Router } from "./router.js";
import { registerAuditRoutes } from "./routes/audit-routes.js";
import { registerCapaRoutes } from "./routes/capa-routes.js";
import { registerInspectionLotRoutes } from "./routes/inspection-lot-routes.js";
import { registerInspectionPlanRoutes } from "./routes/inspection-plan-routes.js";
import { registerNcrRoutes } from "./routes/ncr-routes.js";
import { registerSupplierQualityRoutes } from "./routes/supplier-quality-routes.js";
export function buildRouter(module) {
    const router = new Router();
    router.get("/health", () => ({
        body: { status: "ok", service: "quality-qms", time: module.clock.now() },
    }));
    // Diagnostics: undispatched outbox events (integration-hub will own this).
    router.get("/outbox/pending", async () => ({
        body: { items: await module.outbox.pending() },
    }));
    router.post("/outbox/drain", async () => ({
        body: { items: await module.outbox.drain() },
    }));
    registerInspectionPlanRoutes(router, module.services.plans);
    registerInspectionLotRoutes(router, module.services.lots);
    registerNcrRoutes(router, module.services.ncrs);
    registerCapaRoutes(router, module.services.capas);
    registerSupplierQualityRoutes(router, module.services.supplierQuality);
    registerAuditRoutes(router, module.services.audits);
    return router;
}
export function createQualityQmsServer(module) {
    const router = buildRouter(module);
    return createServer((req, res) => {
        void router.dispatch(req, res);
    });
}
//# sourceMappingURL=server.js.map
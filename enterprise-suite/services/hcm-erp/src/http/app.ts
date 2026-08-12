import type { HcmModule } from "../module.js";
import { jsonOk, Router } from "./router.js";
import { registerAttendanceRoutes } from "./routes/attendance-routes.js";
import { registerCompensationRoutes } from "./routes/compensation-routes.js";
import { registerContractRoutes } from "./routes/contract-routes.js";
import { registerEmployeeRoutes } from "./routes/employee-routes.js";
import { registerLeaveRoutes } from "./routes/leave-routes.js";
import { registerOrgRoutes } from "./routes/org-routes.js";
import { registerRequisitionRoutes } from "./routes/requisition-routes.js";
import { registerSkillsRoutes } from "./routes/skills-routes.js";

/** Wires every HCM route group onto a single router. */
export function buildHcmRouter(module: HcmModule): Router {
  const router = new Router();

  router.get("/health", () => jsonOk({ status: "ok", service: "hcm-erp" }));

  // Outbox integration endpoints for the event dispatcher (integration-hub).
  router.get("/outbox", (req) => jsonOk({ items: module.outbox.peek() }));
  router.post("/outbox/drain", () => {
    const events = module.outbox.drain();
    return jsonOk({ count: events.length, items: events });
  });

  registerOrgRoutes(router, module);
  registerEmployeeRoutes(router, module);
  registerContractRoutes(router, module);
  registerLeaveRoutes(router, module);
  registerAttendanceRoutes(router, module);
  registerCompensationRoutes(router, module);
  registerSkillsRoutes(router, module);
  registerRequisitionRoutes(router, module);

  return router;
}

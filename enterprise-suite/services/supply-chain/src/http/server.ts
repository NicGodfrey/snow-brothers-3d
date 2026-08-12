import { createServer, type Server } from "node:http";
import { createSupplyChainModule, type SupplyChainModule } from "../infrastructure/module.js";
import { Router } from "./router.js";
import { registerAtpRoutes } from "./routes/atp.js";
import { registerForecastRoutes } from "./routes/forecasts.js";
import { registerItemRoutes } from "./routes/items.js";
import { registerPlanningRunRoutes } from "./routes/planning-runs.js";
import { registerSafetyStockRoutes } from "./routes/safety-stock.js";
import { registerSupplierCalendarRoutes } from "./routes/supplier-calendars.js";
import { registerSupplyPlanRoutes } from "./routes/supply-plans.js";

export function buildRouter(module: SupplyChainModule): Router {
  const router = new Router();
  router.get(
    "/health",
    async () => ({ status: 200, body: { status: "ok", service: "supply-chain" } }),
    { anonymous: true },
  );
  registerItemRoutes(router, module);
  registerSafetyStockRoutes(router, module);
  registerForecastRoutes(router, module);
  registerSupplierCalendarRoutes(router, module);
  registerPlanningRunRoutes(router, module);
  registerSupplyPlanRoutes(router, module);
  registerAtpRoutes(router, module);
  return router;
}

export function createSupplyChainServer(module?: SupplyChainModule): Server {
  const resolved = module ?? createSupplyChainModule();
  const router = buildRouter(resolved);
  return createServer((req, res) => {
    void router.dispatch(req, res);
  });
}

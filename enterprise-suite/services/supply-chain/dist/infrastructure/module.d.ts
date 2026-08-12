import { AtpService } from "../application/atp-service.js";
import { CapacityService } from "../application/capacity-service.js";
import { ForecastService } from "../application/forecast-service.js";
import { ItemService } from "../application/item-service.js";
import { PlanningService } from "../application/planning-service.js";
import { SafetyStockService } from "../application/safety-stock-service.js";
import { SupplyPlanService } from "../application/supply-plan-service.js";
import type { Clock, SupplyChainDeps } from "../application/ports.js";
import { InMemoryOutbox } from "./memory/outbox.js";
export interface SupplyChainModule {
    readonly deps: SupplyChainDeps;
    readonly outbox: InMemoryOutbox;
    readonly items: ItemService;
    readonly safetyStock: SafetyStockService;
    readonly forecasts: ForecastService;
    readonly capacity: CapacityService;
    readonly planning: PlanningService;
    readonly supplyPlans: SupplyPlanService;
    readonly atp: AtpService;
}
/** Composition root: in-memory adapters wired to the application services. */
export declare function createSupplyChainModule(options?: {
    clock?: Clock;
}): SupplyChainModule;
//# sourceMappingURL=module.d.ts.map
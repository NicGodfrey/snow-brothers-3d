import { AtpService } from "../application/atp-service.js";
import { CapacityService } from "../application/capacity-service.js";
import { ForecastService } from "../application/forecast-service.js";
import { ItemService } from "../application/item-service.js";
import { PlanningService } from "../application/planning-service.js";
import { SafetyStockService } from "../application/safety-stock-service.js";
import { SupplyPlanService } from "../application/supply-plan-service.js";
import type { Clock, SupplyChainDeps } from "../application/ports.js";
import { SystemClock } from "./clock.js";
import {
  InMemoryAllocationRepository,
  InMemoryDemandForecastRepository,
  InMemoryInventoryRepository,
  InMemoryPlanningItemRepository,
  InMemoryPlanningRunRepository,
  InMemorySafetyStockPolicyRepository,
  InMemoryScheduledReceiptRepository,
  InMemorySupplierCalendarRepository,
  InMemorySupplyPlanRepository,
} from "./memory/memory-repos.js";
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
export function createSupplyChainModule(options?: { clock?: Clock }): SupplyChainModule {
  const outbox = new InMemoryOutbox();
  const deps: SupplyChainDeps = {
    items: new InMemoryPlanningItemRepository(),
    forecasts: new InMemoryDemandForecastRepository(),
    policies: new InMemorySafetyStockPolicyRepository(),
    inventory: new InMemoryInventoryRepository(),
    receipts: new InMemoryScheduledReceiptRepository(),
    plans: new InMemorySupplyPlanRepository(),
    allocations: new InMemoryAllocationRepository(),
    calendars: new InMemorySupplierCalendarRepository(),
    runs: new InMemoryPlanningRunRepository(),
    outbox,
    clock: options?.clock ?? new SystemClock(),
  };
  return {
    deps,
    outbox,
    items: new ItemService(deps),
    safetyStock: new SafetyStockService(deps),
    forecasts: new ForecastService(deps),
    capacity: new CapacityService(deps),
    planning: new PlanningService(deps),
    supplyPlans: new SupplyPlanService(deps),
    atp: new AtpService(deps),
  };
}

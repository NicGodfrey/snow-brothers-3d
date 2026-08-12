import { CapacityService } from "../application/capacity-service.js";
import { MaterialService } from "../application/material-service.js";
import { RoutingService } from "../application/routing-service.js";
import { ScrapService } from "../application/scrap-service.js";
import { WorkCenterService } from "../application/work-center-service.js";
import { WorkOrderService } from "../application/work-order-service.js";
import type { Clock } from "../application/ports.js";
import { InMemoryCapacityCalendarRepository, InMemoryMaterialIssueRepository, InMemoryProductionReceiptRepository, InMemoryRoutingRepository, InMemoryScrapRecordRepository, InMemoryShiftTemplateRepository, InMemoryWorkCenterRepository, InMemoryWorkOrderRepository } from "./in-memory/repositories.js";
import { InMemoryOutbox } from "./outbox.js";
/**
 * Composition root. Wires repositories, the outbox, and the clock into the
 * application services. Swap the in-memory adapters for Postgres-backed
 * ones here without touching domain or application code.
 */
export interface MesContainer {
    outbox: InMemoryOutbox;
    clock: Clock;
    repositories: {
        workCenters: InMemoryWorkCenterRepository;
        shiftTemplates: InMemoryShiftTemplateRepository;
        calendars: InMemoryCapacityCalendarRepository;
        routings: InMemoryRoutingRepository;
        workOrders: InMemoryWorkOrderRepository;
        materialIssues: InMemoryMaterialIssueRepository;
        productionReceipts: InMemoryProductionReceiptRepository;
        scrapRecords: InMemoryScrapRecordRepository;
    };
    services: {
        workCenters: WorkCenterService;
        capacity: CapacityService;
        routings: RoutingService;
        workOrders: WorkOrderService;
        materials: MaterialService;
        scrap: ScrapService;
    };
}
export declare function createContainer(options?: {
    clock?: Clock;
}): MesContainer;
//# sourceMappingURL=container.d.ts.map
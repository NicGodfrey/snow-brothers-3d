import { CapacityService } from "../application/capacity-service.js";
import { MaterialService } from "../application/material-service.js";
import { RoutingService } from "../application/routing-service.js";
import { ScrapService } from "../application/scrap-service.js";
import { WorkCenterService } from "../application/work-center-service.js";
import { WorkOrderService } from "../application/work-order-service.js";
import { SystemClock } from "./clock.js";
import { InMemoryCapacityCalendarRepository, InMemoryMaterialIssueRepository, InMemoryProductionReceiptRepository, InMemoryRoutingRepository, InMemoryScrapRecordRepository, InMemoryShiftTemplateRepository, InMemoryWorkCenterRepository, InMemoryWorkOrderRepository, } from "./in-memory/repositories.js";
import { InMemoryOutbox } from "./outbox.js";
export function createContainer(options) {
    const outbox = new InMemoryOutbox();
    const clock = options?.clock ?? new SystemClock();
    const workCenters = new InMemoryWorkCenterRepository();
    const shiftTemplates = new InMemoryShiftTemplateRepository();
    const calendars = new InMemoryCapacityCalendarRepository();
    const routings = new InMemoryRoutingRepository();
    const workOrders = new InMemoryWorkOrderRepository();
    const materialIssues = new InMemoryMaterialIssueRepository();
    const productionReceipts = new InMemoryProductionReceiptRepository();
    const scrapRecords = new InMemoryScrapRecordRepository();
    return {
        outbox,
        clock,
        repositories: {
            workCenters,
            shiftTemplates,
            calendars,
            routings,
            workOrders,
            materialIssues,
            productionReceipts,
            scrapRecords,
        },
        services: {
            workCenters: new WorkCenterService(workCenters, calendars, outbox),
            capacity: new CapacityService(shiftTemplates, calendars, workCenters, workOrders, outbox),
            routings: new RoutingService(routings, workCenters, outbox),
            workOrders: new WorkOrderService(workOrders, routings, workCenters, calendars, shiftTemplates, scrapRecords, outbox, clock),
            materials: new MaterialService(workOrders, materialIssues, productionReceipts, outbox),
            scrap: new ScrapService(scrapRecords, workOrders, routings, outbox),
        },
    };
}
//# sourceMappingURL=container.js.map
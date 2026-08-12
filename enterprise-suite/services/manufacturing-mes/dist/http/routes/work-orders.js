import { DomainError } from "@enterprise-suite/shared-kernel";
import { SCRAP_DISPOSITIONS } from "../../domain/scrap-record.js";
import { DEMAND_SOURCE_TYPES, WORK_ORDER_STATUSES, } from "../../domain/work-order.js";
import { asRecord, optionalArray, optionalNumber, optionalOneOf, optionalString, requireNumber, requireString, } from "../validate.js";
export function registerWorkOrderRoutes(router, container) {
    const service = container.services.workOrders;
    router.post("/work-orders", async (req) => {
        const body = asRecord(req.body);
        const demandSourceRaw = body.demandSource;
        let demandSource;
        if (demandSourceRaw !== undefined) {
            const ds = asRecord(demandSourceRaw, "demandSource");
            demandSource = {
                type: optionalOneOf(ds, "type", DEMAND_SOURCE_TYPES) ?? "MANUAL",
                refId: optionalString(ds, "refId"),
            };
        }
        const workOrder = await service.create(req.ctx, {
            sku: requireString(body, "sku"),
            quantity: requireNumber(body, "quantity"),
            uom: requireString(body, "uom"),
            dueDate: requireString(body, "dueDate"),
            demandSource,
            routingId: optionalString(body, "routingId"),
            priority: optionalNumber(body, "priority"),
            bomLines: optionalArray(body, "bomLines")?.map((raw, i) => {
                const line = asRecord(raw, `bomLines[${i}]`);
                return {
                    componentSku: requireString(line, "componentSku"),
                    qtyPerUnit: requireNumber(line, "qtyPerUnit"),
                    uom: requireString(line, "uom"),
                    scrapFactorPct: optionalNumber(line, "scrapFactorPct"),
                    operationSeq: optionalNumber(line, "operationSeq"),
                };
            }),
        });
        return { status: 201, body: workOrder.toJSON() };
    });
    router.get("/work-orders", async (req) => {
        const status = req.query.get("status") ?? undefined;
        if (status && !WORK_ORDER_STATUSES.includes(status)) {
            throw new DomainError(`status must be one of [${WORK_ORDER_STATUSES.join(", ")}]`, "VALIDATION", 400);
        }
        const orders = await service.list(req.ctx, {
            status: status,
            sku: req.query.get("sku") ?? undefined,
            dueBefore: req.query.get("dueBefore") ?? undefined,
        });
        return orders.map((wo) => wo.toJSON());
    });
    router.get("/work-orders/:id", async (req) => {
        return (await service.get(req.ctx, req.params.id)).toJSON();
    });
    router.post("/work-orders/:id/plan", async (req) => {
        const body = req.body === undefined ? {} : asRecord(req.body);
        const workOrder = await service.plan(req.ctx, req.params.id, {
            calendarId: optionalString(body, "calendarId"),
        });
        return workOrder.toJSON();
    });
    router.post("/work-orders/:id/release", async (req) => {
        return (await service.release(req.ctx, req.params.id)).toJSON();
    });
    router.post("/work-orders/:id/start", async (req) => {
        return (await service.start(req.ctx, req.params.id)).toJSON();
    });
    router.post("/work-orders/:id/report", async (req) => {
        const body = asRecord(req.body);
        const { workOrder, scrapRecord } = await service.reportOperation(req.ctx, req.params.id, {
            seq: requireNumber(body, "seq"),
            qtyGood: requireNumber(body, "qtyGood"),
            qtyScrap: optionalNumber(body, "qtyScrap"),
            laborMinutes: optionalNumber(body, "laborMinutes"),
            machineMinutes: optionalNumber(body, "machineMinutes"),
            scrapReasonCode: optionalString(body, "scrapReasonCode"),
            scrapDisposition: optionalOneOf(body, "scrapDisposition", SCRAP_DISPOSITIONS),
            scrapNotes: optionalString(body, "scrapNotes"),
        });
        return {
            workOrder: workOrder.toJSON(),
            scrapRecord: scrapRecord?.toJSON() ?? null,
        };
    });
    router.post("/work-orders/:id/hold", async (req) => {
        const body = asRecord(req.body);
        return (await service.hold(req.ctx, req.params.id, requireString(body, "reason"))).toJSON();
    });
    router.post("/work-orders/:id/resume", async (req) => {
        return (await service.resume(req.ctx, req.params.id)).toJSON();
    });
    router.post("/work-orders/:id/complete", async (req) => {
        return (await service.complete(req.ctx, req.params.id)).toJSON();
    });
    router.post("/work-orders/:id/close", async (req) => {
        return (await service.close(req.ctx, req.params.id)).toJSON();
    });
    router.post("/work-orders/:id/cancel", async (req) => {
        const body = asRecord(req.body);
        return (await service.cancel(req.ctx, req.params.id, requireString(body, "reason"))).toJSON();
    });
    router.get("/work-orders/:id/shortages", async (req) => {
        return service.shortages(req.ctx, req.params.id);
    });
    router.get("/work-centers/:id/dispatch-list", async (req) => {
        return service.dispatchList(req.ctx, req.params.id);
    });
}
//# sourceMappingURL=work-orders.js.map
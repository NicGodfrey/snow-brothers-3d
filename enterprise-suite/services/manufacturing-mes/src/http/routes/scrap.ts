import { SCRAP_DISPOSITIONS, SCRAP_REASON_CODES } from "../../domain/scrap-record.js";
import type { MesContainer } from "../../infrastructure/container.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalNumber,
  optionalOneOf,
  optionalString,
  requireNumber,
  requireOneOf,
  requireString,
} from "../validate.js";

export function registerScrapRoutes(router: Router, container: MesContainer): void {
  const service = container.services.scrap;

  router.post("/scrap-records", async (req) => {
    const body = asRecord(req.body);
    const record = await service.recordStandalone(req.ctx, {
      workOrderId: requireString(body, "workOrderId"),
      operationSeq: requireNumber(body, "operationSeq"),
      quantity: requireNumber(body, "quantity"),
      reasonCode: requireOneOf(body, "reasonCode", SCRAP_REASON_CODES),
      disposition: optionalOneOf(body, "disposition", SCRAP_DISPOSITIONS),
      notes: optionalString(body, "notes"),
    });
    return { status: 201, body: record.toJSON() };
  });

  router.get("/scrap-records", async (req) => {
    const records = await service.list(req.ctx, {
      reasonCode: req.query.get("reasonCode") ?? undefined,
    });
    return records.map((r) => r.toJSON());
  });

  router.get("/scrap-records/summary", async (req) => {
    return service.summary(req.ctx);
  });

  router.get("/scrap-records/:id", async (req) => {
    return (await service.get(req.ctx, req.params.id!)).toJSON();
  });

  router.get("/work-orders/:id/scrap-records", async (req) => {
    const records = await service.listForWorkOrder(req.ctx, req.params.id!);
    return records.map((r) => r.toJSON());
  });

  router.post("/scrap-records/:id/rework-order", async (req) => {
    const body = req.body === undefined ? {} : asRecord(req.body);
    const { scrapRecord, reworkOrder } = await service.createReworkOrder(req.ctx, req.params.id!, {
      dueDate: optionalString(body, "dueDate"),
      priority: optionalNumber(body, "priority"),
    });
    return {
      status: 201,
      body: { scrapRecord: scrapRecord.toJSON(), reworkOrder: reworkOrder.toJSON() },
    };
  });
}

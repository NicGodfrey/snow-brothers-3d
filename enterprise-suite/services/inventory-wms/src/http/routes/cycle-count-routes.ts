import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { CycleCountService } from "../../application/cycle-count-service.js";
import {
  invalid,
  isRecord,
  optId,
  optIsoDate,
  optString,
  reqArray,
  reqBody,
  reqId,
  reqInt,
  reqString,
} from "../../application/validation.js";
import { requireWriteRole } from "../context.js";
import { created, okJson, type Route } from "../router.js";

export function cycleCountRoutes(service: CycleCountService): Route[] {
  return [
    {
      method: "POST",
      pattern: "/cycle-counts",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        // Two creation shapes: explicit lines, or "count these bins".
        if (body.binIds !== undefined) {
          const order = await service.createOrderForBins(
            req.ctx,
            reqId(body.warehouseId, "warehouseId"),
            reqArray(body.binIds, "binIds", (item, i) => reqId(item, `binIds[${i}]`)),
            optIsoDate(body.scheduledFor, "scheduledFor"),
          );
          return created(order.toJSON());
        }
        const order = await service.createOrder(req.ctx, {
          warehouseId: reqId(body.warehouseId, "warehouseId"),
          lines: reqArray(body.lines, "lines", (item, i) => {
            if (!isRecord(item)) invalid(`lines[${i}] must be an object`);
            return {
              binId: reqId(item.binId, `lines[${i}].binId`),
              sku: reqString(item.sku, `lines[${i}].sku`, { maxLength: 64 }),
              lotId: optId(item.lotId, `lines[${i}].lotId`) ?? null,
            };
          }),
          scheduledFor: optIsoDate(body.scheduledFor, "scheduledFor"),
          notes: optString(body.notes, "notes", { maxLength: 500 }),
        });
        return created(order.toJSON());
      },
    },
    {
      method: "GET",
      pattern: "/cycle-counts",
      handler: async (req) => {
        const orders = await service.listOrders(req.ctx, {
          warehouseId: (req.query.get("warehouseId") as Ulid | null) ?? undefined,
        });
        return okJson({ items: orders.map((o) => o.toJSON()) });
      },
    },
    {
      method: "GET",
      pattern: "/cycle-counts/:id",
      handler: async (req) => {
        const order = await service.getOrder(req.ctx, reqId(req.params.id, "id"));
        return okJson(order.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/cycle-counts/:id/start",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const order = await service.startOrder(req.ctx, reqId(req.params.id, "id"));
        return okJson(order.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/cycle-counts/:id/lines/:lineId/count",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const order = await service.recordCount(
          req.ctx,
          reqId(req.params.id, "id"),
          reqId(req.params.lineId, "lineId"),
          reqInt(body.countedQty, "countedQty", { min: 0 }),
        );
        return okJson(order.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/cycle-counts/:id/recount",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const order = await service.requestRecount(
          req.ctx,
          reqId(req.params.id, "id"),
          reqArray(body.lineIds, "lineIds", (item, i) => reqId(item, `lineIds[${i}]`)),
        );
        return okJson(order.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/cycle-counts/:id/complete",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const { order, adjustedLines } = await service.completeOrder(
          req.ctx,
          reqId(req.params.id, "id"),
        );
        return okJson({ order: order.toJSON(), adjustedLines });
      },
    },
    {
      method: "POST",
      pattern: "/cycle-counts/:id/cancel",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = isRecord(req.body) ? req.body : {};
        const order = await service.cancelOrder(
          req.ctx,
          reqId(req.params.id, "id"),
          optString(body.reason, "reason", { maxLength: 200 }),
        );
        return okJson(order.toJSON());
      },
    },
  ];
}

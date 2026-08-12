import type { Ulid } from "@enterprise-suite/shared-kernel";
import { ALLOCATION_STRATEGIES } from "../../application/allocation.js";
import type { ReservationService } from "../../application/reservation-service.js";
import {
  invalid,
  isRecord,
  optBool,
  optEnum,
  optString,
  reqArray,
  reqBody,
  reqId,
  reqInt,
  reqString,
} from "../../application/validation.js";
import type { Reservation } from "../../domain/reservation.js";
import { requireWriteRole } from "../context.js";
import { created, okJson, type Route } from "../router.js";

function reservationView(reservation: Reservation) {
  return {
    ...reservation.toJSON(),
    isFullyAllocated: reservation.isFullyAllocated,
  };
}

export function reservationRoutes(service: ReservationService): Route[] {
  return [
    {
      method: "POST",
      pattern: "/reservations",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const report = await service.createReservation(req.ctx, {
          salesOrderId: reqString(body.salesOrderId, "salesOrderId", { maxLength: 64 }),
          warehouseId: reqId(body.warehouseId, "warehouseId"),
          lines: reqArray(body.lines, "lines", (item, i) => {
            if (!isRecord(item)) invalid(`lines[${i}] must be an object`);
            return {
              sku: reqString(item.sku, `lines[${i}].sku`, { maxLength: 64 }),
              qty: reqInt(item.qty, `lines[${i}].qty`, { min: 1 }),
              uom: optString(item.uom, `lines[${i}].uom`, { maxLength: 8 }),
            };
          }),
          strategy: optEnum(body.strategy, "strategy", ALLOCATION_STRATEGIES),
          autoAllocate: optBool(body.autoAllocate, "autoAllocate"),
          notes: optString(body.notes, "notes", { maxLength: 500 }),
        });
        return created({
          reservation: reservationView(report.reservation),
          shortages: report.shortages,
        });
      },
    },
    {
      method: "GET",
      pattern: "/reservations",
      handler: async (req) => {
        const reservations = await service.listReservations(req.ctx, {
          warehouseId: (req.query.get("warehouseId") as Ulid | null) ?? undefined,
          salesOrderId: req.query.get("salesOrderId") ?? undefined,
          activeOnly: req.query.get("activeOnly") === "true",
        });
        return okJson({ items: reservations.map(reservationView) });
      },
    },
    {
      method: "GET",
      pattern: "/reservations/:id",
      handler: async (req) => {
        const reservation = await service.getReservation(req.ctx, reqId(req.params.id, "id"));
        return okJson(reservationView(reservation));
      },
    },
    {
      method: "POST",
      pattern: "/reservations/:id/allocate",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = isRecord(req.body) ? req.body : {};
        const report = await service.allocate(
          req.ctx,
          reqId(req.params.id, "id"),
          optEnum(body.strategy, "strategy", ALLOCATION_STRATEGIES) ?? "FEFO",
        );
        return okJson({
          reservation: reservationView(report.reservation),
          shortages: report.shortages,
        });
      },
    },
    {
      method: "POST",
      pattern: "/reservations/:id/release",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const reservation = await service.release(req.ctx, reqId(req.params.id, "id"));
        return okJson(reservationView(reservation));
      },
    },
    {
      method: "POST",
      pattern: "/reservations/:id/cancel",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = isRecord(req.body) ? req.body : {};
        const reservation = await service.cancel(
          req.ctx,
          reqId(req.params.id, "id"),
          optString(body.reason, "reason", { maxLength: 200 }),
        );
        return okJson(reservationView(reservation));
      },
    },
    {
      method: "POST",
      pattern: "/reservations/:id/fulfill",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = isRecord(req.body) ? req.body : {};
        const reservation = await service.fulfill(req.ctx, reqId(req.params.id, "id"), {
          allowPartial: optBool(body.allowPartial, "allowPartial"),
        });
        return okJson(reservationView(reservation));
      },
    },
  ];
}

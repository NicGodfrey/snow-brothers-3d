import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { StockService } from "../../application/stock-service.js";
import {
  invalid,
  isRecord,
  optEnum,
  optId,
  optInt,
  optIsoDate,
  optString,
  reqArray,
  reqBody,
  reqEnum,
  reqId,
  reqInt,
  reqString,
} from "../../application/validation.js";
import {
  ADJUSTMENT_REASONS,
  STOCK_REF_TYPES,
  TRANSACTION_TYPES,
  type StockRef,
} from "../../domain/inventory-transaction.js";
import { requireWriteRole } from "../context.js";
import { created, okJson, type Route } from "../router.js";

function parseRef(value: unknown): StockRef | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) invalid("ref must be an object { type, id }");
  return {
    type: reqEnum(value.type, "ref.type", STOCK_REF_TYPES),
    id: reqString(value.id, "ref.id", { maxLength: 64 }),
  };
}

function parseLot(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) invalid("lot must be an object");
  return {
    lotCode: reqString(value.lotCode, "lot.lotCode", { maxLength: 64 }),
    manufacturedAt: optIsoDate(value.manufacturedAt, "lot.manufacturedAt"),
    expiresAt: optIsoDate(value.expiresAt, "lot.expiresAt"),
    supplierRef: optString(value.supplierRef, "lot.supplierRef", { maxLength: 64 }),
  };
}

export function stockRoutes(service: StockService): Route[] {
  return [
    {
      method: "POST",
      pattern: "/stock/receipts",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const putaway = body.putaway;
        if (putaway !== undefined && putaway !== null && !isRecord(putaway)) {
          invalid("putaway must be an object { suggestedBinId }");
        }
        const result = await service.receiveStock(req.ctx, {
          warehouseId: reqId(body.warehouseId, "warehouseId"),
          binId: reqId(body.binId, "binId"),
          sku: reqString(body.sku, "sku", { maxLength: 64 }),
          quantity: reqInt(body.quantity, "quantity", { min: 1 }),
          uom: optString(body.uom, "uom", { maxLength: 8 }),
          lot: parseLot(body.lot),
          serialNumbers:
            body.serialNumbers === undefined || body.serialNumbers === null
              ? undefined
              : reqArray(body.serialNumbers, "serialNumbers", (item, i) =>
                  reqString(item, `serialNumbers[${i}]`, { maxLength: 64 }),
                ),
          ref: parseRef(body.ref),
          note: optString(body.note, "note", { maxLength: 500 }),
          putaway:
            putaway && isRecord(putaway)
              ? { suggestedBinId: reqId(putaway.suggestedBinId, "putaway.suggestedBinId") }
              : undefined,
        });
        return created({
          balance: result.balance.toJSON(),
          transaction: result.transaction,
          lot: result.lot?.toJSON() ?? null,
          serials: result.serials.map((s) => s.toJSON()),
          putawayTask: result.putawayTask?.toJSON() ?? null,
        });
      },
    },
    {
      method: "POST",
      pattern: "/stock/issues",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const result = await service.issueStock(req.ctx, {
          warehouseId: reqId(body.warehouseId, "warehouseId"),
          binId: reqId(body.binId, "binId"),
          sku: reqString(body.sku, "sku", { maxLength: 64 }),
          lotId: optId(body.lotId, "lotId") ?? null,
          quantity: reqInt(body.quantity, "quantity", { min: 1 }),
          ref: parseRef(body.ref),
          note: optString(body.note, "note", { maxLength: 500 }),
        });
        return created({ transaction: result.transaction });
      },
    },
    {
      method: "POST",
      pattern: "/stock/transfers",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const result = await service.transferStock(req.ctx, {
          warehouseId: reqId(body.warehouseId, "warehouseId"),
          fromBinId: reqId(body.fromBinId, "fromBinId"),
          toBinId: reqId(body.toBinId, "toBinId"),
          sku: reqString(body.sku, "sku", { maxLength: 64 }),
          lotId: optId(body.lotId, "lotId") ?? null,
          quantity: reqInt(body.quantity, "quantity", { min: 1 }),
          ref: parseRef(body.ref),
          note: optString(body.note, "note", { maxLength: 500 }),
        });
        return created({ transaction: result.transaction });
      },
    },
    {
      method: "POST",
      pattern: "/stock/adjustments",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const result = await service.adjustStock(req.ctx, {
          warehouseId: reqId(body.warehouseId, "warehouseId"),
          binId: reqId(body.binId, "binId"),
          sku: reqString(body.sku, "sku", { maxLength: 64 }),
          lotId: optId(body.lotId, "lotId") ?? null,
          newOnHand: optInt(body.newOnHand, "newOnHand", { min: 0 }),
          deltaQty: optInt(body.deltaQty, "deltaQty"),
          reasonCode: reqEnum(body.reasonCode, "reasonCode", ADJUSTMENT_REASONS),
          ref: parseRef(body.ref),
          note: optString(body.note, "note", { maxLength: 500 }),
        });
        return created({ transaction: result.transaction });
      },
    },
    {
      method: "GET",
      pattern: "/stock/balances",
      handler: async (req) => {
        const balances = await service.listBalances(req.ctx, {
          warehouseId: (req.query.get("warehouseId") as Ulid | null) ?? undefined,
          binId: (req.query.get("binId") as Ulid | null) ?? undefined,
          sku: req.query.get("sku") ?? undefined,
          nonEmptyOnly: req.query.get("nonEmptyOnly") === "true",
        });
        return okJson({ items: balances.map((b) => ({ ...b.toJSON(), available: b.available })) });
      },
    },
    {
      method: "GET",
      pattern: "/stock/availability/:sku",
      handler: async (req) => {
        const availability = await service.getAvailability(
          req.ctx,
          reqString(req.params.sku, "sku", { maxLength: 64 }),
          (req.query.get("warehouseId") as Ulid | null) ?? undefined,
        );
        return okJson(availability);
      },
    },
    {
      method: "GET",
      pattern: "/stock/transactions",
      handler: async (req) => {
        const transactions = await service.listTransactions(req.ctx, {
          warehouseId: (req.query.get("warehouseId") as Ulid | null) ?? undefined,
          sku: req.query.get("sku") ?? undefined,
          txnType: optEnum(req.query.get("txnType") ?? undefined, "txnType", TRANSACTION_TYPES),
          refType: optEnum(req.query.get("refType") ?? undefined, "refType", STOCK_REF_TYPES),
          refId: req.query.get("refId") ?? undefined,
          binId: (req.query.get("binId") as Ulid | null) ?? undefined,
        });
        return okJson({ items: transactions });
      },
    },
    {
      method: "GET",
      pattern: "/lots",
      handler: async (req) => {
        const sku = req.query.get("sku");
        if (!sku) invalid("sku query parameter is required");
        const lots = await service.listLots(req.ctx, sku);
        return okJson({ items: lots.map((l) => l.toJSON()) });
      },
    },
    {
      method: "POST",
      pattern: "/lots/:lotId/quarantine",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const lot = await service.setLotStatus(
          req.ctx,
          reqId(req.params.lotId, "lotId"),
          "quarantine",
        );
        return okJson(lot.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/lots/:lotId/release",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const lot = await service.setLotStatus(req.ctx, reqId(req.params.lotId, "lotId"), "release");
        return okJson(lot.toJSON());
      },
    },
    {
      method: "GET",
      pattern: "/serials",
      handler: async (req) => {
        const sku = req.query.get("sku");
        if (!sku) invalid("sku query parameter is required");
        const serials = await service.listSerials(req.ctx, sku);
        return okJson({ items: serials.map((s) => s.toJSON()) });
      },
    },
  ];
}

import { DomainError, type Ulid } from "@enterprise-suite/shared-kernel";
import type { DemandRefType } from "../../domain/allocation.js";
import type { ReceiptSourceType } from "../../domain/records.js";
import { locationCode } from "../../domain/types.js";
import type { SupplyChainModule } from "../../infrastructure/module.js";
import type { Router } from "../router.js";
import {
  asObject,
  optionalBoolean,
  optionalString,
  queryInt,
  requireLocation,
  requireNumber,
  requireString,
} from "../validate.js";

const DEMAND_REF_TYPES: readonly string[] = ["SALES_ORDER", "TRANSFER_ORDER", "MANUAL"];
const RECEIPT_SOURCE_TYPES: readonly string[] = ["PURCHASE_ORDER", "WORK_ORDER", "TRANSFER_ORDER"];

export function registerAtpRoutes(router: Router, module: SupplyChainModule): void {
  router.get("/atp", async (req) => {
    const sku = req.query.sku;
    if (!sku) throw new DomainError("sku query parameter is required", "VALIDATION");
    const rows = await module.atp.atpReport(
      req.ctx,
      sku,
      requireLocation(req.query),
      queryInt(req.query, "weeks", 12, 1, 104),
    );
    return { status: 200, body: { sku: sku.toUpperCase(), rows } };
  });

  router.post("/ctp", async (req) => {
    const body = asObject(req.body);
    const result = await module.atp.ctp(req.ctx, {
      sku: requireString(body, "sku"),
      location: requireLocation(body),
      qty: requireNumber(body, "qty"),
      needDate: requireString(body, "needDate"),
      horizonWeeks: body.horizonWeeks === undefined ? undefined : requireNumber(body, "horizonWeeks"),
    });
    return { status: 200, body: result };
  });

  router.post("/allocations", async (req) => {
    const body = asObject(req.body);
    const refType = optionalString(body, "demandRefType");
    if (refType !== undefined && !DEMAND_REF_TYPES.includes(refType)) {
      throw new DomainError(`demandRefType must be one of ${DEMAND_REF_TYPES.join(", ")}`, "VALIDATION");
    }
    const { allocation, atpAtNeedDate } = await module.atp.createAllocation(req.ctx, {
      sku: requireString(body, "sku"),
      location: requireLocation(body),
      qty: requireNumber(body, "qty"),
      needDate: requireString(body, "needDate"),
      demandRefType: refType as DemandRefType | undefined,
      demandRef: requireString(body, "demandRef"),
      force: optionalBoolean(body, "force"),
    });
    return { status: 201, body: { ...allocation.toJSON(), atpAtNeedDate } };
  });

  router.get("/allocations", async (req) => {
    const allocations = await module.atp.listAllocations(req.ctx, {
      sku: req.query.sku?.toUpperCase(),
      location: req.query.location ? locationCode(req.query.location) : undefined,
      status: req.query.status,
    });
    return { status: 200, body: { allocations: allocations.map((a) => a.toJSON()) } };
  });

  router.post("/allocations/:id/cancel", async (req) => {
    const allocation = await module.atp.cancelAllocation(req.ctx, req.params.id as Ulid);
    return { status: 200, body: allocation.toJSON() };
  });

  /** Integration inbox: projections pushed from Inventory / Procurement. */
  router.put("/inventory", async (req) => {
    const body = asObject(req.body);
    await module.atp.upsertInventory(req.ctx, {
      sku: requireString(body, "sku"),
      location: requireLocation(body),
      onHandQty: requireNumber(body, "onHandQty"),
    });
    return { status: 204, body: null };
  });

  router.get("/inventory", async (req) => {
    const records = await module.deps.inventory.list(
      req.ctx.tenantId,
      req.query.location ? locationCode(req.query.location) : undefined,
    );
    return { status: 200, body: { records } };
  });

  router.put("/scheduled-receipts", async (req) => {
    const body = asObject(req.body);
    const sourceType = requireString(body, "sourceType");
    if (!RECEIPT_SOURCE_TYPES.includes(sourceType)) {
      throw new DomainError(`sourceType must be one of ${RECEIPT_SOURCE_TYPES.join(", ")}`, "VALIDATION");
    }
    const id = await module.atp.addScheduledReceipt(req.ctx, {
      sku: requireString(body, "sku"),
      location: requireLocation(body),
      dueDate: requireString(body, "dueDate"),
      qty: requireNumber(body, "qty"),
      sourceType: sourceType as ReceiptSourceType,
      sourceRef: requireString(body, "sourceRef"),
    });
    return { status: 201, body: { id } };
  });

  router.get("/scheduled-receipts", async (req) => {
    const receipts = await module.deps.receipts.list(
      req.ctx.tenantId,
      req.query.location ? locationCode(req.query.location) : undefined,
    );
    const sku = req.query.sku?.toUpperCase();
    return { status: 200, body: { receipts: sku ? receipts.filter((r) => r.sku === sku) : receipts } };
  });

  router.delete("/scheduled-receipts/:id", async (req) => {
    await module.atp.removeScheduledReceipt(req.ctx, req.params.id as Ulid);
    return { status: 204, body: null };
  });
}

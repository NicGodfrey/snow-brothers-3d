import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { SupplyChainModule } from "../../infrastructure/module.js";
import type { ProcurementType } from "../../domain/planning-item.js";
import { DomainError } from "@enterprise-suite/shared-kernel";
import type { Router } from "../router.js";
import {
  asObject,
  optionalArray,
  optionalNumber,
  optionalString,
  requireNumber,
  requireString,
} from "../validate.js";

export function registerItemRoutes(router: Router, module: SupplyChainModule): void {
  router.post("/items", async (req) => {
    const body = asObject(req.body);
    const procurementType = requireString(body, "procurementType");
    if (procurementType !== "MAKE" && procurementType !== "BUY") {
      throw new DomainError("procurementType must be MAKE or BUY", "VALIDATION");
    }
    const bomRaw = optionalArray(body, "bom");
    const item = await module.items.createItem(req.ctx, {
      sku: requireString(body, "sku"),
      description: requireString(body, "description"),
      uom: optionalString(body, "uom"),
      procurementType: procurementType as ProcurementType,
      leadTimeDays: requireNumber(body, "leadTimeDays"),
      lotSizing: body.lotSizing,
      safetyStockPolicyId: optionalString(body, "safetyStockPolicyId") as Ulid | undefined,
      preferredSupplierId: optionalString(body, "preferredSupplierId"),
      standardCostMinor: optionalNumber(body, "standardCostMinor"),
      currency: optionalString(body, "currency"),
      bom: bomRaw?.map((line, i) => {
        const obj = asObject(line, `bom[${i}]`);
        return {
          componentSku: requireString(obj, "componentSku"),
          qtyPer: requireNumber(obj, "qtyPer"),
          scrapPct: optionalNumber(obj, "scrapPct"),
        };
      }),
    });
    return { status: 201, body: item.toJSON() };
  });

  router.get("/items", async (req) => {
    const items = await module.items.listItems(req.ctx);
    return { status: 200, body: { items: items.map((i) => i.toJSON()) } };
  });

  router.get("/items/:id", async (req) => {
    const item = await module.items.getItem(req.ctx, req.params.id as Ulid);
    return { status: 200, body: item.toJSON() };
  });

  router.put("/items/:id/lot-sizing", async (req) => {
    const item = await module.items.changeLotSizing(req.ctx, req.params.id as Ulid, asObject(req.body));
    return { status: 200, body: item.toJSON() };
  });

  router.put("/items/:id/bom", async (req) => {
    const body = asObject(req.body);
    const lines = (optionalArray(body, "lines") ?? []).map((line, i) => {
      const obj = asObject(line, `lines[${i}]`);
      return {
        componentSku: requireString(obj, "componentSku"),
        qtyPer: requireNumber(obj, "qtyPer"),
        scrapPct: optionalNumber(obj, "scrapPct"),
      };
    });
    const item = await module.items.replaceBom(req.ctx, req.params.id as Ulid, lines);
    return { status: 200, body: item.toJSON() };
  });

  router.put("/items/:id/safety-stock-policy", async (req) => {
    const body = asObject(req.body);
    const policyId = optionalString(body, "policyId");
    const item = await module.items.assignSafetyStockPolicy(
      req.ctx,
      req.params.id as Ulid,
      (policyId as Ulid | undefined) ?? null,
    );
    return { status: 200, body: item.toJSON() };
  });

  router.post("/items/:id/deactivate", async (req) => {
    const item = await module.items.deactivateItem(req.ctx, req.params.id as Ulid);
    return { status: 200, body: item.toJSON() };
  });
}

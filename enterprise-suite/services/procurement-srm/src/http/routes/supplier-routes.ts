import { RISK_TIERS, SUPPLIER_STATUSES } from "../../domain/supplier.js";
import type { ProcurementModule } from "../../module.js";
import {
  asRecord,
  optEnumField,
  optInt,
  optMoneyField,
  optStr,
  optStrList,
  optUlid,
  queryEnum,
  queryStr,
  requireRole,
  str,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

/**
 * Procurement's local supplier directory. `srm-core` owns onboarding, so the
 * write endpoints here are deliberately narrow: register a supplier procurement
 * can transact with, block one, and accept a mirrored master-data change.
 */
export function registerSupplierRoutes(router: Router, module: ProcurementModule): void {
  const { supplierDirectory } = module;

  router.post("/suppliers", (req) => {
    requireRole(req.ctx, "procurement_admin", "buyer");
    const body = asRecord(req.body);
    const supplier = supplierDirectory.register(req.ctx.tenantId, {
      supplierNumber: str(body, "supplierNumber"),
      legalName: str(body, "legalName"),
      currency: str(body, "currency"),
      displayName: optStr(body, "displayName"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      defaultIncoterm: optStr(body, "defaultIncoterm"),
      categories: optStrList(body, "categories"),
      riskTier: optEnumField(body, "riskTier", RISK_TIERS),
      qualityScoreBps: optInt(body, "qualityScoreBps"),
      defaultLeadTimeDays: optInt(body, "defaultLeadTimeDays"),
      minimumOrderValue: optMoneyField(body, "minimumOrderValue"),
      contactEmail: optStr(body, "contactEmail"),
      status: optEnumField(body, "status", SUPPLIER_STATUSES),
      externalId: optUlid(body, "externalId"),
    });
    return created(supplier.toJSON());
  });

  router.get("/suppliers", (req) =>
    jsonOk({
      items: supplierDirectory
        .list(req.ctx.tenantId, {
          status: queryEnum(req.query, "status", SUPPLIER_STATUSES),
          categoryCode: queryStr(req.query, "category"),
        })
        .map((supplier) => supplier.toJSON()),
    }),
  );

  router.get("/suppliers/:supplierId", (req) =>
    jsonOk(supplierDirectory.get(req.ctx.tenantId, ulidParam(req.params, "supplierId")).toJSON()),
  );

  router.get("/suppliers/by-number/:supplierNumber", (req) =>
    jsonOk(supplierDirectory.getByNumber(req.ctx.tenantId, req.params.supplierNumber).toJSON()),
  );

  router.post("/suppliers/:supplierId/block", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const body = asRecord(req.body);
    const supplier = supplierDirectory.block(
      req.ctx.tenantId,
      ulidParam(req.params, "supplierId"),
      str(body, "reason"),
    );
    return jsonOk(supplier.toJSON());
  });

  router.post("/suppliers/:supplierId/unblock", (req) => {
    requireRole(req.ctx, "procurement_admin");
    return jsonOk(
      supplierDirectory.unblock(req.ctx.tenantId, ulidParam(req.params, "supplierId")).toJSON(),
    );
  });

  router.post("/suppliers/:supplierId/categories", (req) => {
    requireRole(req.ctx, "procurement_admin", "buyer");
    const body = asRecord(req.body);
    const supplier = supplierDirectory.addCategory(
      req.ctx.tenantId,
      ulidParam(req.params, "supplierId"),
      str(body, "categoryCode"),
    );
    return jsonOk(supplier.toJSON());
  });

  /** Upsert mirrored from the supplier master; also the integration handler's entry point. */
  router.post("/suppliers/sync", (req) => {
    requireRole(req.ctx, "procurement_admin", "integration");
    const body = asRecord(req.body);
    const supplier = supplierDirectory.syncFromMaster(req.ctx.tenantId, {
      externalId: optUlid(body, "externalId"),
      supplierNumber: str(body, "supplierNumber"),
      legalName: optStr(body, "legalName"),
      displayName: optStr(body, "displayName"),
      status: optEnumField(body, "status", SUPPLIER_STATUSES),
      currency: optStr(body, "currency"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      defaultIncoterm: optStr(body, "defaultIncoterm"),
      categories: optStrList(body, "categories"),
      riskTier: optEnumField(body, "riskTier", RISK_TIERS),
      qualityScoreBps: optInt(body, "qualityScoreBps"),
      defaultLeadTimeDays: optInt(body, "defaultLeadTimeDays"),
      contactEmail: optStr(body, "contactEmail"),
      blockReason: optStr(body, "blockReason"),
    });
    return jsonOk(supplier.toJSON());
  });
}

import { money } from "@enterprise-suite/shared-kernel";
import {
  AGREEMENT_STATUSES,
  AGREEMENT_TYPES,
  type AgreementLineInput,
  type PriceTier,
} from "../../domain/blanket-agreement.js";
import { quantity } from "../../domain/common.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  arrayOf,
  asOptionalRecord,
  asRecord,
  dateField,
  int,
  intParam,
  moneyField,
  num,
  optArrayOf,
  optBool,
  optDateField,
  optEnumField,
  optInt,
  optMoneyField,
  optNum,
  optStr,
  optUlid,
  queryCurrency,
  queryEnum,
  queryInt,
  queryStr,
  queryUlid,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

function parsePriceTier(record: Record<string, unknown>, currency: string): PriceTier {
  return {
    minQuantity: quantity(num(record, "minQuantity")),
    unitPrice: money(int(record, "unitPriceMinor"), currency),
    effectiveFrom: optDateField(record, "effectiveFrom"),
    effectiveTo: optDateField(record, "effectiveTo"),
  };
}

function parseAgreementLine(
  record: Record<string, unknown>,
  currency: string,
): AgreementLineInput {
  return {
    description: str(record, "description"),
    categoryCode: str(record, "categoryCode"),
    uom: str(record, "uom"),
    unitPrice: money(int(record, "unitPriceMinor"), currency),
    itemCode: optStr(record, "itemCode"),
    contractedQuantity: optNum(record, "contractedQuantity"),
    maximumQuantity: optNum(record, "maximumQuantity"),
    leadTimeDays: optInt(record, "leadTimeDays"),
    priceTiers: optArrayOf(record, "priceTiers", (tier) => parsePriceTier(tier, currency)),
  };
}

/**
 * Blanket / contract agreements and the releases drawn against them. A release
 * prices itself from the agreement's tiers and produces a purchase order.
 */
export function registerAgreementRoutes(router: Router, module: ProcurementModule): void {
  const { agreementService } = module;

  router.post("/agreements", (req) => {
    const body = asRecord(req.body);
    const maximumValue = moneyField(body, "maximumValue");
    const currency = optStr(body, "currency") ?? maximumValue.currency;
    const agreement = agreementService.create(req.ctx.tenantId, {
      title: str(body, "title"),
      supplierId: ulidField(body, "supplierId"),
      ownerId: optUlid(body, "ownerId") ?? actorId(req.ctx),
      effectiveFrom: dateField(body, "effectiveFrom"),
      effectiveTo: dateField(body, "effectiveTo"),
      maximumValue,
      currency,
      agreementType: optEnumField(body, "agreementType", AGREEMENT_TYPES),
      minimumCommitment: optMoneyField(body, "minimumCommitment"),
      releaseLimit: optMoneyField(body, "releaseLimit"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      incoterm: optStr(body, "incoterm"),
      autoReleaseApproved: optBool(body, "autoReleaseApproved"),
      renewalNoticeDays: optInt(body, "renewalNoticeDays"),
      notes: optStr(body, "notes"),
      lines: optArrayOf(body, "lines", (line) => parseAgreementLine(line, currency)),
    });
    return created(agreement.toJSON());
  });

  router.get("/agreements", (req) =>
    jsonOk({
      items: agreementService
        .list(req.ctx.tenantId, {
          status: queryEnum(req.query, "status", AGREEMENT_STATUSES),
          supplierId: queryUlid(req.query, "supplierId"),
        })
        .map((agreement) => agreement.toJSON()),
    }),
  );

  /** Agreements inside their renewal notice window. */
  router.get("/agreements/renewals-due", (req) =>
    jsonOk({ items: agreementService.renewalsDue(req.ctx.tenantId).map((a) => a.toJSON()) }),
  );

  router.get("/agreements/commitments", (req) =>
    jsonOk({
      items: agreementService.commitmentReport(req.ctx.tenantId).map((entry) => ({
        agreementId: entry.agreement.id,
        agreementNumber: entry.agreement.agreementNumber,
        supplierId: entry.agreement.supplierId,
        releasedValue: entry.releasedValue,
        minimumCommitment: entry.minimumCommitment,
        progressBps: entry.progressBps,
        daysToExpiry: entry.daysToExpiry,
      })),
    }),
  );

  /** Cheapest contracted price for an item, if it is already under contract. */
  router.get("/agreements/best-price", (req) => {
    const itemCode = queryStr(req.query, "itemCode");
    if (!itemCode) return jsonOk({ found: false });
    const best = agreementService.bestContractPrice(
      req.ctx.tenantId,
      itemCode,
      queryInt(req.query, "quantity", 1),
    );
    if (!best) return jsonOk({ found: false });
    return jsonOk({
      found: true,
      agreementId: best.agreement.id,
      agreementNumber: best.agreement.agreementNumber,
      supplierId: best.agreement.supplierId,
      lineNumber: best.lineNumber,
      unitPrice: best.unitPrice,
    });
  });

  router.post("/agreements/expire-due", (req) => {
    const expired = agreementService.expireDue(req.ctx.tenantId);
    return jsonOk({ expired: expired.length, items: expired.map((a) => a.toJSON()) });
  });

  router.get("/agreements/by-number/:agreementNumber", (req) =>
    jsonOk(agreementService.getByNumber(req.ctx.tenantId, req.params.agreementNumber).toJSON()),
  );

  router.get("/agreements/:agreementId", (req) =>
    jsonOk(agreementService.get(req.ctx.tenantId, ulidParam(req.params, "agreementId")).toJSON()),
  );

  router.post("/agreements/:agreementId/lines", (req) => {
    const agreementId = ulidParam(req.params, "agreementId");
    const agreement = agreementService.get(req.ctx.tenantId, agreementId);
    const line = agreementService.addLine(
      req.ctx.tenantId,
      agreementId,
      parseAgreementLine(asRecord(req.body), agreement.currency),
    );
    return created(line.toJSON());
  });

  router.post("/agreements/:agreementId/lines/:lineNumber/price-tiers", (req) => {
    const agreementId = ulidParam(req.params, "agreementId");
    const agreement = agreementService.get(req.ctx.tenantId, agreementId);
    const line = agreementService.addPriceTier(
      req.ctx.tenantId,
      agreementId,
      intParam(req.params, "lineNumber"),
      parsePriceTier(asRecord(req.body), agreement.currency),
    );
    return created(line.toJSON());
  });

  router.post("/agreements/:agreementId/activate", (req) =>
    jsonOk(
      agreementService.activate(req.ctx.tenantId, ulidParam(req.params, "agreementId")).toJSON(),
    ),
  );

  router.post("/agreements/:agreementId/suspend", (req) => {
    const body = asRecord(req.body);
    const agreement = agreementService.suspend(
      req.ctx.tenantId,
      ulidParam(req.params, "agreementId"),
      str(body, "reason"),
    );
    return jsonOk(agreement.toJSON());
  });

  router.post("/agreements/:agreementId/resume", (req) =>
    jsonOk(agreementService.resume(req.ctx.tenantId, ulidParam(req.params, "agreementId")).toJSON()),
  );

  router.post("/agreements/:agreementId/close", (req) => {
    const body = asRecord(req.body);
    const agreement = agreementService.close(
      req.ctx.tenantId,
      ulidParam(req.params, "agreementId"),
      str(body, "reason"),
    );
    return jsonOk(agreement.toJSON());
  });

  /** Prices a prospective release without reserving anything. */
  router.post("/agreements/:agreementId/quote", (req) => {
    const body = asRecord(req.body);
    const quote = agreementService.quote(
      req.ctx.tenantId,
      ulidParam(req.params, "agreementId"),
      arrayOf(body, "lines", (record) => ({
        lineNumber: int(record, "lineNumber"),
        quantity: num(record, "quantity"),
      })),
    );
    return jsonOk(quote);
  });

  router.post("/agreements/:agreementId/releases", (req) => {
    const body = asRecord(req.body);
    const result = agreementService.release(req.ctx.tenantId, ulidParam(req.params, "agreementId"), {
      buyerId: optUlid(body, "buyerId") ?? actorId(req.ctx),
      lines: arrayOf(body, "lines", (record) => ({
        lineNumber: int(record, "lineNumber"),
        quantity: num(record, "quantity"),
        needBy: dateField(record, "needBy"),
      })),
      shipTo: str(body, "shipTo"),
      requisitionId: optUlid(body, "requisitionId"),
      notes: optStr(body, "notes"),
      autoIssue: optBool(body, "autoIssue"),
    });
    return created({
      agreement: result.agreement.toJSON(),
      purchaseOrder: result.order.toJSON(),
      release: result.release,
    });
  });

  router.get("/suppliers/:supplierId/contract-availability", (req) =>
    jsonOk(
      agreementService.availableValue(
        req.ctx.tenantId,
        ulidParam(req.params, "supplierId"),
        queryCurrency(req.query),
      ),
    ),
  );
}

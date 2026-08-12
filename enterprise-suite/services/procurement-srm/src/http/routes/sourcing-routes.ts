import { money } from "@enterprise-suite/shared-kernel";
import type { AwardDecision } from "../../application/sourcing-service.js";
import type { QuoteLineInput } from "../../domain/quote.js";
import { RFQ_STATUSES, type RfqLineInput } from "../../domain/rfq.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  arrayOf,
  asOptionalRecord,
  asRecord,
  dateField,
  int,
  intList,
  num,
  optArrayOf,
  optBool,
  optDateField,
  optInt,
  optMoneyField,
  optStr,
  optUlid,
  optUlidList,
  queryBool,
  queryDate,
  queryEnum,
  queryUlid,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

function parseRfqLine(record: Record<string, unknown>): RfqLineInput {
  return {
    description: str(record, "description"),
    categoryCode: str(record, "categoryCode"),
    quantity: num(record, "quantity"),
    uom: str(record, "uom"),
    requiredBy: dateField(record, "requiredBy"),
    itemCode: optStr(record, "itemCode"),
    specification: optStr(record, "specification"),
    alternativesAllowed: optBool(record, "alternativesAllowed"),
  };
}

function parseWeights(body: Record<string, unknown>) {
  const raw = body.evaluationWeights;
  if (raw === undefined || raw === null) return undefined;
  const record = asRecord(raw);
  return {
    priceBps: optInt(record, "priceBps"),
    leadTimeBps: optInt(record, "leadTimeBps"),
    qualityBps: optInt(record, "qualityBps"),
    complianceBps: optInt(record, "complianceBps"),
  };
}

function parseQuoteLine(record: Record<string, unknown>, currency: string): QuoteLineInput {
  return {
    rfqLineNumber: int(record, "rfqLineNumber"),
    unitPrice: money(int(record, "unitPriceMinor"), currency),
    quantity: num(record, "quantity"),
    uom: str(record, "uom"),
    leadTimeDays: int(record, "leadTimeDays"),
    discountBps: optInt(record, "discountBps"),
    taxBps: optInt(record, "taxBps"),
    minimumOrderQuantity: optInt(record, "minimumOrderQuantity"),
    alternativeItemCode: optStr(record, "alternativeItemCode"),
    notes: optStr(record, "notes"),
  };
}

/**
 * Competitive sourcing: build an RFQ, invite suppliers, capture bids, score
 * them and turn the award into purchase orders.
 */
export function registerSourcingRoutes(router: Router, module: ProcurementModule): void {
  const { sourcingService } = module;

  // -- RFQ --------------------------------------------------------------------

  router.post("/rfqs", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.createRfq(req.ctx.tenantId, {
      title: str(body, "title"),
      buyerId: optUlid(body, "buyerId") ?? actorId(req.ctx),
      currency: str(body, "currency"),
      responseDeadline: dateField(body, "responseDeadline"),
      deliveryLocation: str(body, "deliveryLocation"),
      questionsDeadline: optDateField(body, "questionsDeadline"),
      incoterm: optStr(body, "incoterm"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      sealed: optBool(body, "sealed"),
      evaluationWeights: parseWeights(body),
      requisitionIds: optUlidList(body, "requisitionIds"),
      scopeNotes: optStr(body, "scopeNotes"),
      lines: optArrayOf(body, "lines", parseRfqLine),
    });
    return created(rfq.toJSON());
  });

  router.post("/rfqs/from-requisition", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.createRfqFromRequisition(req.ctx.tenantId, {
      requisitionId: ulidField(body, "requisitionId"),
      buyerId: optUlid(body, "buyerId") ?? actorId(req.ctx),
      responseDeadline: dateField(body, "responseDeadline"),
      lineIds: optUlidList(body, "lineIds"),
      title: optStr(body, "title"),
      sealed: optBool(body, "sealed"),
      incoterm: optStr(body, "incoterm"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      evaluationWeights: parseWeights(body),
    });
    return created(rfq.toJSON());
  });

  router.get("/rfqs", (req) =>
    jsonOk({
      items: sourcingService
        .listRfqs(req.ctx.tenantId, {
          status: queryEnum(req.query, "status", RFQ_STATUSES),
          supplierId: queryUlid(req.query, "supplierId"),
        })
        .map((rfq) => rfq.toJSON()),
    }),
  );

  router.get("/rfqs/:rfqId", (req) =>
    jsonOk(sourcingService.getRfq(req.ctx.tenantId, ulidParam(req.params, "rfqId")).toJSON()),
  );

  router.post("/rfqs/:rfqId/lines", (req) => {
    const rfq = sourcingService.addRfqLine(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      parseRfqLine(asRecord(req.body)),
    );
    return created(rfq.toJSON());
  });

  router.post("/rfqs/:rfqId/invitations", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.inviteSupplier(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      ulidField(body, "supplierId"),
    );
    return jsonOk(rfq.toJSON());
  });

  /** Invites every active supplier covering the RFQ's categories. */
  router.post("/rfqs/:rfqId/invitations/by-category", (req) =>
    jsonOk(
      sourcingService.inviteByCategory(req.ctx.tenantId, ulidParam(req.params, "rfqId")).toJSON(),
    ),
  );

  router.post("/rfqs/:rfqId/invitations/:supplierId/decline", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.declineInvitation(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      ulidParam(req.params, "supplierId"),
      str(body, "reason"),
    );
    return jsonOk(rfq.toJSON());
  });

  router.post("/rfqs/:rfqId/issue", (req) =>
    jsonOk(sourcingService.issueRfq(req.ctx.tenantId, ulidParam(req.params, "rfqId")).toJSON()),
  );

  router.post("/rfqs/:rfqId/amendments", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.amendRfq(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      str(body, "note"),
      {
        scopeNotes: optStr(body, "scopeNotes"),
        deliveryLocation: optStr(body, "deliveryLocation"),
        incoterm: optStr(body, "incoterm"),
      },
    );
    return created(rfq.toJSON());
  });

  router.post("/rfqs/:rfqId/extend-deadline", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.extendDeadline(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      dateField(body, "responseDeadline"),
      str(body, "reason"),
    );
    return jsonOk(rfq.toJSON());
  });

  router.post("/rfqs/:rfqId/close", (req) => {
    const body = asOptionalRecord(req.body);
    const rfq = sourcingService.closeRfq(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      optStr(body, "reason"),
    );
    return jsonOk(rfq.toJSON());
  });

  router.post("/rfqs/:rfqId/cancel", (req) => {
    const body = asRecord(req.body);
    const rfq = sourcingService.cancelRfq(
      req.ctx.tenantId,
      ulidParam(req.params, "rfqId"),
      str(body, "reason"),
    );
    return jsonOk(rfq.toJSON());
  });

  // -- quotes -----------------------------------------------------------------

  router.post("/rfqs/:rfqId/quotes", (req) => {
    const rfqId = ulidParam(req.params, "rfqId");
    const rfq = sourcingService.getRfq(req.ctx.tenantId, rfqId);
    const body = asRecord(req.body);
    const quote = sourcingService.submitQuote(req.ctx.tenantId, {
      rfqId,
      supplierId: ulidField(body, "supplierId"),
      validUntil: dateField(body, "validUntil"),
      lines: arrayOf(body, "lines", (line) => parseQuoteLine(line, rfq.currency)),
      incoterm: optStr(body, "incoterm"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      supplierReference: optStr(body, "supplierReference"),
      freightCharge: optMoneyField(body, "freightCharge"),
      notes: optStr(body, "notes"),
    });
    return created(quote.toJSON());
  });

  router.get("/quotes", (req) =>
    jsonOk({
      items: sourcingService
        .listQuotes(req.ctx.tenantId, {
          rfqId: queryUlid(req.query, "rfqId"),
          supplierId: queryUlid(req.query, "supplierId"),
        })
        .map((quote) => quote.toJSON()),
    }),
  );

  router.get("/quotes/:quoteId", (req) =>
    jsonOk(sourcingService.getQuote(req.ctx.tenantId, ulidParam(req.params, "quoteId")).toJSON()),
  );

  router.post("/quotes/:quoteId/withdraw", (req) => {
    const body = asRecord(req.body);
    const quote = sourcingService.withdrawQuote(
      req.ctx.tenantId,
      ulidParam(req.params, "quoteId"),
      str(body, "reason"),
    );
    return jsonOk(quote.toJSON());
  });

  router.post("/quotes/:quoteId/shortlist", (req) =>
    jsonOk(
      sourcingService.shortlistQuote(req.ctx.tenantId, ulidParam(req.params, "quoteId")).toJSON(),
    ),
  );

  router.post("/quotes/:quoteId/reject", (req) => {
    const body = asRecord(req.body);
    const quote = sourcingService.rejectQuote(
      req.ctx.tenantId,
      ulidParam(req.params, "quoteId"),
      str(body, "reason"),
    );
    return jsonOk(quote.toJSON());
  });

  router.post("/quotes/expire", (req) => {
    const expired = sourcingService.expireQuotes(req.ctx.tenantId);
    return jsonOk({ expired: expired.length, items: expired.map((quote) => quote.toJSON()) });
  });

  // -- evaluation and award ---------------------------------------------------

  router.get("/rfqs/:rfqId/evaluation", (req) =>
    jsonOk(
      sourcingService.evaluate(req.ctx.tenantId, ulidParam(req.params, "rfqId"), {
        onDate: queryDate(req.query, "onDate"),
        allowPartial: queryBool(req.query, "allowPartial"),
      }),
    ),
  );

  router.post("/rfqs/:rfqId/award", (req) => {
    const body = asRecord(req.body);
    const decisions: AwardDecision[] = arrayOf(body, "decisions", (record) => ({
      quoteId: ulidField(record, "quoteId"),
      lineNumbers: intList(record, "lineNumbers"),
      note: optStr(record, "note"),
    }));
    const result = sourcingService.award(req.ctx.tenantId, ulidParam(req.params, "rfqId"), {
      awardedBy: optUlid(body, "awardedBy") ?? actorId(req.ctx),
      decisions,
      shipTo: optStr(body, "shipTo"),
      rejectOthers: optBool(body, "rejectOthers"),
      rejectionReason: optStr(body, "rejectionReason"),
    });
    return created({
      rfq: result.rfq.toJSON(),
      purchaseOrders: result.purchaseOrders.map((order) => order.toJSON()),
      awardedValue: result.awardedValue,
    });
  });
}


import { money } from "@enterprise-suite/shared-kernel";
import type { RegisterInvoiceInput } from "../../application/matching-service.js";
import { INVOICE_STATUSES, type InvoiceLineInput } from "../../domain/invoice.js";
import type { MatchTolerances } from "../../domain/three-way-match.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  asOptionalRecord,
  asRecord,
  dateField,
  enumField,
  int,
  moneyField,
  num,
  optArrayOf,
  optBool,
  optDateField,
  optEnumField,
  optInt,
  optMoneyField,
  optStr,
  optUlid,
  queryEnum,
  queryUlid,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

function parseInvoiceLine(record: Record<string, unknown>, currency: string): InvoiceLineInput {
  return {
    description: str(record, "description"),
    quantity: num(record, "quantity"),
    uom: str(record, "uom"),
    unitPrice: money(int(record, "unitPriceMinor"), currency),
    purchaseOrderLineNumber: optInt(record, "purchaseOrderLineNumber"),
    taxBps: optInt(record, "taxBps"),
    itemCode: optStr(record, "itemCode"),
    glAccount: optStr(record, "glAccount"),
    chargeType: optEnumField(record, "chargeType", ["goods", "freight", "misc"] as const),
  };
}

function parseInvoice(body: Record<string, unknown>): RegisterInvoiceInput {
  const declaredTotal = moneyField(body, "declaredTotal");
  const currency = optStr(body, "currency") ?? declaredTotal.currency;
  return {
    supplierInvoiceNumber: str(body, "supplierInvoiceNumber"),
    supplierId: ulidField(body, "supplierId"),
    invoiceDate: dateField(body, "invoiceDate"),
    declaredTotal,
    purchaseOrderId: optUlid(body, "purchaseOrderId"),
    currency,
    receivedDate: optDateField(body, "receivedDate"),
    paymentTermsDays: optInt(body, "paymentTermsDays"),
    dueDate: optDateField(body, "dueDate"),
    declaredTaxTotal: optMoneyField(body, "declaredTaxTotal"),
    notes: optStr(body, "notes"),
    lines: optArrayOf(body, "lines", (line) => parseInvoiceLine(line, currency)),
  };
}

function parseTolerances(body: Record<string, unknown>): Partial<MatchTolerances> | undefined {
  const raw = body.tolerances;
  if (raw === undefined || raw === null) return undefined;
  const record = asRecord(raw);
  return {
    priceVarianceBps: optInt(record, "priceVarianceBps"),
    quantityVarianceBps: optInt(record, "quantityVarianceBps"),
    totalRoundingMinor: optInt(record, "totalRoundingMinor"),
    requireReceipt: optBool(record, "requireReceipt"),
  };
}

/**
 * Supplier invoices and the three-way match. Downstream of
 * `approved_for_payment` everything belongs to finance-erp, which subscribes to
 * the event rather than calling back in.
 */
export function registerInvoiceRoutes(router: Router, module: ProcurementModule): void {
  const { matchingService } = module;

  router.post("/invoices", (req) => {
    const body = asRecord(req.body);
    const invoice = matchingService.register(req.ctx.tenantId, parseInvoice(body));
    return created(invoice.toJSON());
  });

  /** AP-inbox path: register and match in one call. */
  router.post("/invoices/register-and-match", (req) => {
    const body = asRecord(req.body);
    const { invoice, result } = matchingService.registerAndMatch(req.ctx.tenantId, parseInvoice(body));
    return created({ invoice: invoice.toJSON(), match: result });
  });

  router.get("/invoices", (req) =>
    jsonOk({
      items: matchingService
        .list(req.ctx.tenantId, {
          status: queryEnum(req.query, "status", INVOICE_STATUSES),
          supplierId: queryUlid(req.query, "supplierId"),
          purchaseOrderId: queryUlid(req.query, "purchaseOrderId"),
        })
        .map((invoice) => invoice.toJSON()),
    }),
  );

  /** The AP work queue: invoices blocked on match exceptions, worst first. */
  router.get("/invoices/exception-queue", (req) =>
    jsonOk({
      items: matchingService.exceptionQueue(req.ctx.tenantId).map(({ invoice, exceptions }) => ({
        invoice: invoice.toJSON(),
        exceptions,
      })),
    }),
  );

  router.get("/invoices/exception-statistics", (req) =>
    jsonOk({ items: matchingService.exceptionStatistics(req.ctx.tenantId) }),
  );

  router.get("/invoices/overdue", (req) =>
    jsonOk({ items: matchingService.overdue(req.ctx.tenantId).map((i) => i.toJSON()) }),
  );

  router.get("/invoices/:invoiceId", (req) =>
    jsonOk(matchingService.get(req.ctx.tenantId, ulidParam(req.params, "invoiceId")).toJSON()),
  );

  router.post("/invoices/:invoiceId/lines", (req) => {
    const invoiceId = ulidParam(req.params, "invoiceId");
    const invoice = matchingService.get(req.ctx.tenantId, invoiceId);
    const line = matchingService.addLine(
      req.ctx.tenantId,
      invoiceId,
      parseInvoiceLine(asRecord(req.body), invoice.currency),
    );
    return created(line.toJSON());
  });

  router.post("/invoices/:invoiceId/link-purchase-order", (req) => {
    const body = asRecord(req.body);
    const invoice = matchingService.linkPurchaseOrder(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      ulidField(body, "purchaseOrderId"),
    );
    return jsonOk(invoice.toJSON());
  });

  router.post("/invoices/:invoiceId/match", (req) => {
    const body = asOptionalRecord(req.body);
    const { invoice, result } = matchingService.match(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      parseTolerances(body),
    );
    return jsonOk({ invoice: invoice.toJSON(), match: result });
  });

  router.post("/invoices/:invoiceId/exceptions/resolve", (req) => {
    const body = asRecord(req.body);
    const resolution = matchingService.resolveException(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      {
        code: str(body, "code"),
        lineNumber: optInt(body, "lineNumber"),
        action: enumField(body, "action", ["resolved", "waived"] as const),
        note: str(body, "note"),
        resolvedBy: optUlid(body, "resolvedBy") ?? actorId(req.ctx),
      },
    );
    return jsonOk(resolution);
  });

  router.post("/invoices/:invoiceId/hold", (req) => {
    const body = asRecord(req.body);
    const invoice = matchingService.hold(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      str(body, "reason"),
    );
    return jsonOk(invoice.toJSON());
  });

  router.post("/invoices/:invoiceId/release", (req) =>
    jsonOk(matchingService.release(req.ctx.tenantId, ulidParam(req.params, "invoiceId")).toJSON()),
  );

  router.post("/invoices/:invoiceId/approve-for-payment", (req) => {
    const body = asOptionalRecord(req.body);
    const invoice = matchingService.approveForPayment(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      optUlid(body, "approvedBy") ?? actorId(req.ctx),
    );
    return jsonOk(invoice.toJSON());
  });

  router.post("/invoices/:invoiceId/reject", (req) => {
    const body = asRecord(req.body);
    const invoice = matchingService.reject(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      str(body, "reason"),
    );
    return jsonOk(invoice.toJSON());
  });

  router.post("/invoices/:invoiceId/cancel", (req) => {
    const body = asRecord(req.body);
    const invoice = matchingService.cancel(
      req.ctx.tenantId,
      ulidParam(req.params, "invoiceId"),
      str(body, "reason"),
    );
    return jsonOk(invoice.toJSON());
  });

  /** GR/IR balance for an order: received but not yet invoiced. */
  router.get("/purchase-orders/:purchaseOrderId/gr-ir", (req) =>
    jsonOk(
      matchingService.goodsReceivedNotInvoiced(
        req.ctx.tenantId,
        ulidParam(req.params, "purchaseOrderId"),
      ),
    ),
  );
}

import { money, type Money } from "@enterprise-suite/shared-kernel";
import type { RequisitionLineSelection } from "../../application/purchase-order-service.js";
import { PURCHASE_ORDER_STATUSES, type PurchaseOrderLineInput } from "../../domain/purchase-order.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  arrayOf,
  asOptionalRecord,
  asRecord,
  dateField,
  int,
  intParam,
  num,
  optArrayOf,
  optDateField,
  optInt,
  optNum,
  optStr,
  optUlid,
  optUlidList,
  queryCurrency,
  queryEnum,
  queryUlid,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, noContent, type Router } from "../router.js";

function parseOrderLine(record: Record<string, unknown>, currency: string): PurchaseOrderLineInput {
  return {
    description: str(record, "description"),
    categoryCode: str(record, "categoryCode"),
    quantity: num(record, "quantity"),
    uom: str(record, "uom"),
    unitPrice: money(int(record, "unitPriceMinor"), currency),
    needBy: dateField(record, "needBy"),
    itemCode: optStr(record, "itemCode"),
    discountBps: optInt(record, "discountBps"),
    taxBps: optInt(record, "taxBps"),
    requisitionId: optUlid(record, "requisitionId"),
    requisitionLineId: optUlid(record, "requisitionLineId"),
    chargeAccount: optStr(record, "chargeAccount"),
    notes: optStr(record, "notes"),
  };
}

function parseTolerances(body: Record<string, unknown>) {
  const raw = body.tolerances;
  if (raw === undefined || raw === null) return undefined;
  const record = asRecord(raw);
  return {
    overReceiptBps: optInt(record, "overReceiptBps"),
    priceVarianceBps: optInt(record, "priceVarianceBps"),
    revisionReapprovalBps: optInt(record, "revisionReapprovalBps"),
  };
}

/** Buying side: draft, approve, issue, revise and close purchase orders. */
export function registerPurchaseOrderRoutes(router: Router, module: ProcurementModule): void {
  const { purchaseOrderService } = module;

  router.post("/purchase-orders", (req) => {
    const body = asRecord(req.body);
    const supplierId = ulidField(body, "supplierId");
    const currency =
      optStr(body, "currency") ?? module.supplierDirectory.get(req.ctx.tenantId, supplierId).currency;
    const order = purchaseOrderService.create(req.ctx.tenantId, {
      supplierId,
      buyerId: optUlid(body, "buyerId") ?? actorId(req.ctx),
      currency,
      shipTo: str(body, "shipTo"),
      billTo: optStr(body, "billTo"),
      orderDate: optDateField(body, "orderDate"),
      incoterm: optStr(body, "incoterm"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      tolerances: parseTolerances(body),
      supplierReference: optStr(body, "supplierReference"),
      requisitionIds: optUlidList(body, "requisitionIds"),
      notes: optStr(body, "notes"),
      lines: optArrayOf(body, "lines", (line) => parseOrderLine(line, currency)),
    });
    return created(order.toJSON());
  });

  /** Converts approved requisition lines and reserves their quantity. */
  router.post("/purchase-orders/from-requisition", (req) => {
    const body = asRecord(req.body);
    const requisitionId = ulidField(body, "requisitionId");
    const requisition = module.requisitionService.get(req.ctx.tenantId, requisitionId);
    const lineSelections: RequisitionLineSelection[] = arrayOf(body, "lineSelections", (record) => ({
      lineId: ulidField(record, "lineId"),
      quantity: optNum(record, "quantity"),
      unitPrice: optUnitPrice(record, requisition.currency),
      taxBps: optInt(record, "taxBps"),
      needBy: optDateField(record, "needBy"),
    }));
    const order = purchaseOrderService.createFromRequisition(req.ctx.tenantId, {
      requisitionId,
      supplierId: ulidField(body, "supplierId"),
      buyerId: optUlid(body, "buyerId") ?? actorId(req.ctx),
      lineSelections,
      shipTo: optStr(body, "shipTo"),
      incoterm: optStr(body, "incoterm"),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      tolerances: parseTolerances(body),
      notes: optStr(body, "notes"),
    });
    return created(order.toJSON());
  });

  router.get("/purchase-orders", (req) =>
    jsonOk({
      items: purchaseOrderService
        .list(req.ctx.tenantId, {
          status: queryEnum(req.query, "status", PURCHASE_ORDER_STATUSES),
          supplierId: queryUlid(req.query, "supplierId"),
          requisitionId: queryUlid(req.query, "requisitionId"),
          agreementId: queryUlid(req.query, "agreementId"),
        })
        .map((order) => order.toJSON()),
    }),
  );

  /** Issued work awaiting goods — what the receiving desk expects. */
  router.get("/purchase-orders/receivable", (req) =>
    jsonOk({ items: purchaseOrderService.listReceivable(req.ctx.tenantId).map((o) => o.toJSON()) }),
  );

  router.get("/purchase-orders/expedite", (req) =>
    jsonOk({
      items: purchaseOrderService.expediteList(req.ctx.tenantId).map((entry) => ({
        purchaseOrderId: entry.order.id,
        orderNumber: entry.order.orderNumber,
        supplierId: entry.order.supplierId,
        lineNumber: entry.lineNumber,
        dueDate: entry.dueDate,
        daysLate: entry.daysLate,
      })),
    }),
  );

  router.get("/purchase-orders/open-commitment", (req) =>
    jsonOk(purchaseOrderService.openCommitment(req.ctx.tenantId, queryCurrency(req.query))),
  );

  router.get("/purchase-orders/by-number/:orderNumber", (req) =>
    jsonOk(purchaseOrderService.getByNumber(req.ctx.tenantId, req.params.orderNumber).toJSON()),
  );

  router.get("/purchase-orders/:purchaseOrderId", (req) =>
    jsonOk(
      purchaseOrderService.get(req.ctx.tenantId, ulidParam(req.params, "purchaseOrderId")).toJSON(),
    ),
  );

  router.post("/purchase-orders/:purchaseOrderId/lines", (req) => {
    const purchaseOrderId = ulidParam(req.params, "purchaseOrderId");
    const order = purchaseOrderService.get(req.ctx.tenantId, purchaseOrderId);
    const line = purchaseOrderService.addLine(
      req.ctx.tenantId,
      purchaseOrderId,
      parseOrderLine(asRecord(req.body), order.currency),
    );
    return created(line.toJSON());
  });

  router.patch("/purchase-orders/:purchaseOrderId/lines/:lineId", (req) => {
    const purchaseOrderId = ulidParam(req.params, "purchaseOrderId");
    const order = purchaseOrderService.get(req.ctx.tenantId, purchaseOrderId);
    const body = asRecord(req.body);
    const line = purchaseOrderService.updateLine(
      req.ctx.tenantId,
      purchaseOrderId,
      ulidParam(req.params, "lineId"),
      {
        quantity: optNum(body, "quantity"),
        unitPrice: optUnitPrice(body, order.currency),
        needBy: optDateField(body, "needBy"),
        description: optStr(body, "description"),
        discountBps: optInt(body, "discountBps"),
        taxBps: optInt(body, "taxBps"),
        notes: optStr(body, "notes"),
      },
    );
    return jsonOk(line.toJSON());
  });

  router.delete("/purchase-orders/:purchaseOrderId/lines/:lineId", (req) => {
    purchaseOrderService.removeLine(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      ulidParam(req.params, "lineId"),
    );
    return noContent();
  });

  router.post("/purchase-orders/:purchaseOrderId/submit", (req) => {
    const body = asOptionalRecord(req.body);
    const order = purchaseOrderService.submitForApproval(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      optStr(body, "policyCode"),
    );
    return jsonOk(order.toJSON());
  });

  router.post("/purchase-orders/:purchaseOrderId/issue", (req) =>
    jsonOk(
      purchaseOrderService
        .issue(req.ctx.tenantId, ulidParam(req.params, "purchaseOrderId"))
        .toJSON(),
    ),
  );

  router.post("/purchase-orders/:purchaseOrderId/acknowledge", (req) => {
    const body = asOptionalRecord(req.body);
    const order = purchaseOrderService.acknowledge(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      {
        supplierReference: optStr(body, "supplierReference"),
        promisedDates: optArrayOf(body, "promisedDates", (record) => ({
          lineNumber: int(record, "lineNumber"),
          promisedDate: dateField(record, "promisedDate"),
        })),
      },
    );
    return jsonOk(order.toJSON());
  });

  /** Change order. A material increase reopens approval automatically. */
  router.post("/purchase-orders/:purchaseOrderId/revisions", (req) => {
    const purchaseOrderId = ulidParam(req.params, "purchaseOrderId");
    const existing = purchaseOrderService.get(req.ctx.tenantId, purchaseOrderId);
    const body = asRecord(req.body);
    const { order, revision } = purchaseOrderService.revise(req.ctx.tenantId, purchaseOrderId, {
      changedBy: optUlid(body, "changedBy") ?? actorId(req.ctx),
      reason: str(body, "reason"),
      lineChanges: optArrayOf(body, "lineChanges", (record) => ({
        lineId: ulidField(record, "lineId"),
        quantity: optNum(record, "quantity"),
        unitPrice: optUnitPrice(record, existing.currency),
        needBy: optDateField(record, "needBy"),
        description: optStr(record, "description"),
        discountBps: optInt(record, "discountBps"),
        taxBps: optInt(record, "taxBps"),
      })),
      newLines: optArrayOf(body, "newLines", (line) => parseOrderLine(line, existing.currency)),
      paymentTermsDays: optInt(body, "paymentTermsDays"),
      incoterm: optStr(body, "incoterm"),
      shipTo: optStr(body, "shipTo"),
      policyCode: optStr(body, "policyCode"),
    });
    return created({ order: order.toJSON(), revision });
  });

  router.post("/purchase-orders/:purchaseOrderId/lines/:lineNumber/close", (req) => {
    const body = asRecord(req.body);
    const line = purchaseOrderService.closeLine(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      intParam(req.params, "lineNumber"),
      str(body, "reason"),
    );
    return jsonOk(line.toJSON());
  });

  router.post("/purchase-orders/:purchaseOrderId/lines/:lineNumber/cancel", (req) => {
    const body = asRecord(req.body);
    const line = purchaseOrderService.cancelLine(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      intParam(req.params, "lineNumber"),
      str(body, "reason"),
    );
    return jsonOk(line.toJSON());
  });

  router.post("/purchase-orders/:purchaseOrderId/close", (req) => {
    const body = asRecord(req.body);
    const order = purchaseOrderService.close(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      str(body, "reason"),
    );
    return jsonOk(order.toJSON());
  });

  router.post("/purchase-orders/:purchaseOrderId/cancel", (req) => {
    const body = asRecord(req.body);
    const order = purchaseOrderService.cancel(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
      str(body, "reason"),
    );
    return jsonOk(order.toJSON());
  });
}

function optUnitPrice(record: Record<string, unknown>, currency: string): Money | undefined {
  const minor = optInt(record, "unitPriceMinor");
  return minor === undefined ? undefined : money(minor, currency);
}

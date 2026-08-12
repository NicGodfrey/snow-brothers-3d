import type { ReceiptLineRequest } from "../../application/receipt-service.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  asRecord,
  enumField,
  int,
  num,
  optArrayOf,
  optBool,
  optDateField,
  optNum,
  optStr,
  optStrList,
  optUlid,
  queryBool,
  queryUlid,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, noContent, type Router } from "../router.js";

function parseReceiptLine(record: Record<string, unknown>): ReceiptLineRequest {
  return {
    purchaseOrderLineNumber: int(record, "purchaseOrderLineNumber"),
    receivedQuantity: num(record, "receivedQuantity"),
    uom: optStr(record, "uom"),
    purchaseOrderLineId: optUlid(record, "purchaseOrderLineId"),
    itemCode: optStr(record, "itemCode"),
    description: optStr(record, "description"),
    acceptedQuantity: optNum(record, "acceptedQuantity"),
    rejectedQuantity: optNum(record, "rejectedQuantity"),
    rejectionReason: optStr(record, "rejectionReason"),
    inspectionRequired: optBool(record, "inspectionRequired"),
    storageLocation: optStr(record, "storageLocation"),
    lotNumber: optStr(record, "lotNumber"),
    serialNumbers: optStrList(record, "serialNumbers"),
    expiryDate: optDateField(record, "expiryDate"),
  };
}

/**
 * Receiving. A receipt stays a draft until posted; posting is the only path
 * that touches the purchase order, so tolerance breaches surface in one place.
 */
export function registerReceiptRoutes(router: Router, module: ProcurementModule): void {
  const { receiptService } = module;

  router.post("/receipts", (req) => {
    const body = asRecord(req.body);
    const receipt = receiptService.draft(req.ctx.tenantId, {
      purchaseOrderId: ulidField(body, "purchaseOrderId"),
      receivedBy: optUlid(body, "receivedBy") ?? actorId(req.ctx),
      receiptDate: optDateField(body, "receiptDate"),
      deliveryNoteReference: optStr(body, "deliveryNoteReference"),
      carrier: optStr(body, "carrier"),
      waybillNumber: optStr(body, "waybillNumber"),
      notes: optStr(body, "notes"),
      lines: optArrayOf(body, "lines", parseReceiptLine),
    });
    return created(receipt.toJSON());
  });

  router.get("/receipts", (req) =>
    jsonOk({
      items: receiptService
        .list(req.ctx.tenantId, {
          purchaseOrderId: queryUlid(req.query, "purchaseOrderId"),
          supplierId: queryUlid(req.query, "supplierId"),
          postedOnly: queryBool(req.query, "postedOnly"),
        })
        .map((receipt) => receipt.toJSON()),
    }),
  );

  router.get("/receipts/:receiptId", (req) =>
    jsonOk(receiptService.get(req.ctx.tenantId, ulidParam(req.params, "receiptId")).toJSON()),
  );

  router.post("/receipts/:receiptId/lines", (req) => {
    const line = receiptService.addLine(
      req.ctx.tenantId,
      ulidParam(req.params, "receiptId"),
      parseReceiptLine(asRecord(req.body)),
    );
    return created(line.toJSON());
  });

  router.delete("/receipts/:receiptId/lines/:lineId", (req) => {
    receiptService.removeLine(
      req.ctx.tenantId,
      ulidParam(req.params, "receiptId"),
      ulidParam(req.params, "lineId"),
    );
    return noContent();
  });

  router.post("/receipts/:receiptId/inspections", (req) => {
    const body = asRecord(req.body);
    const line = receiptService.recordInspection(
      req.ctx.tenantId,
      ulidParam(req.params, "receiptId"),
      {
        lineId: ulidField(body, "lineId"),
        outcome: enumField(body, "outcome", ["passed", "failed", "partial"] as const),
        rejectedQuantity: optNum(body, "rejectedQuantity"),
        reason: optStr(body, "reason"),
        inspectorId: optUlid(body, "inspectorId") ?? actorId(req.ctx),
      },
    );
    return jsonOk(line.toJSON());
  });

  /** Applies every line to the purchase order, then marks the receipt posted. */
  router.post("/receipts/:receiptId/post", (req) => {
    const { receipt, order } = receiptService.post(
      req.ctx.tenantId,
      ulidParam(req.params, "receiptId"),
    );
    return jsonOk({ receipt: receipt.toJSON(), purchaseOrder: order.toJSON() });
  });

  router.post("/receipts/:receiptId/reverse", (req) => {
    const body = asRecord(req.body);
    const { receipt, order } = receiptService.reverse(
      req.ctx.tenantId,
      ulidParam(req.params, "receiptId"),
      str(body, "reason"),
    );
    return jsonOk({ receipt: receipt.toJSON(), purchaseOrder: order.toJSON() });
  });

  router.post("/receipts/:receiptId/returns", (req) => {
    const body = asRecord(req.body);
    const { record, order } = receiptService.returnToVendor(
      req.ctx.tenantId,
      ulidParam(req.params, "receiptId"),
      {
        lineId: ulidField(body, "lineId"),
        quantity: num(body, "quantity"),
        reason: str(body, "reason"),
        rmaReference: optStr(body, "rmaReference"),
      },
    );
    return created({ return: record, purchaseOrder: order.toJSON() });
  });

  router.get("/purchase-orders/:purchaseOrderId/received-quantities", (req) => {
    const totals = receiptService.receivedByOrderLine(
      req.ctx.tenantId,
      ulidParam(req.params, "purchaseOrderId"),
    );
    return jsonOk({
      items: [...totals.entries()].map(([lineNumber, quantity]) => ({ lineNumber, quantity })),
    });
  });

  router.get("/suppliers/:supplierId/delivery-performance", (req) =>
    jsonOk(
      receiptService.onTimeDeliveryBps(req.ctx.tenantId, ulidParam(req.params, "supplierId")),
    ),
  );
}

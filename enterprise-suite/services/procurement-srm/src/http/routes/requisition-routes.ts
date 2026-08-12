import type { Money } from "@enterprise-suite/shared-kernel";
import { lineInput } from "../../application/requisition-service.js";
import type { RequisitionLineInput } from "../../domain/requisition.js";
import { REQUISITION_PRIORITIES, REQUISITION_STATUSES } from "../../domain/requisition.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  asOptionalRecord,
  asRecord,
  dateField,
  int,
  num,
  optArrayOf,
  optDateField,
  optEnumField,
  optMinorPrice,
  optNum,
  optStr,
  optUlid,
  queryEnum,
  queryStr,
  queryUlid,
  str,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, noContent, type Router } from "../router.js";

function parseLine(record: Record<string, unknown>, currency: string): RequisitionLineInput {
  return lineInput({
    description: str(record, "description"),
    categoryCode: str(record, "categoryCode"),
    quantity: num(record, "quantity"),
    uom: str(record, "uom"),
    unitPriceMinor: int(record, "unitPriceMinor"),
    currency,
    neededBy: optDateField(record, "neededBy"),
    itemCode: optStr(record, "itemCode"),
    suggestedSupplierId: optUlid(record, "suggestedSupplierId"),
    glAccount: optStr(record, "glAccount"),
  });
}

/** Demand side: raise, price, submit and track purchase requisitions. */
export function registerRequisitionRoutes(router: Router, module: ProcurementModule): void {
  const { requisitionService } = module;

  router.post("/requisitions", (req) => {
    const body = asRecord(req.body);
    const currency = str(body, "currency");
    const requisition = requisitionService.create(req.ctx.tenantId, {
      title: str(body, "title"),
      requesterId: optUlid(body, "requesterId") ?? actorId(req.ctx),
      costCenter: str(body, "costCenter"),
      currency,
      neededBy: dateField(body, "neededBy"),
      deliverTo: str(body, "deliverTo"),
      priority: optEnumField(body, "priority", REQUISITION_PRIORITIES),
      justification: optStr(body, "justification"),
      budgetCode: optStr(body, "budgetCode"),
      projectCode: optStr(body, "projectCode"),
      notes: optStr(body, "notes"),
      lines: optArrayOf(body, "lines", (line) => parseLine(line, currency)),
    });
    return created(requisition.toJSON());
  });

  router.get("/requisitions", (req) =>
    jsonOk({
      items: requisitionService
        .list(req.ctx.tenantId, {
          status: queryEnum(req.query, "status", REQUISITION_STATUSES),
          requesterId: queryUlid(req.query, "requesterId"),
          costCenter: queryStr(req.query, "costCenter"),
        })
        .map((requisition) => requisition.toJSON()),
    }),
  );

  /** Approved demand still awaiting an order — the buyer's sourcing worklist. */
  router.get("/requisitions/sourceable", (req) =>
    jsonOk({
      items: requisitionService.listSourceable(req.ctx.tenantId).map((r) => r.toJSON()),
    }),
  );

  router.get("/requisitions/demand-by-category", (req) =>
    jsonOk({ items: requisitionService.demandByCategory(req.ctx.tenantId) }),
  );

  router.get("/requisitions/overdue", (req) =>
    jsonOk({
      items: requisitionService.overdueDemand(req.ctx.tenantId).map(({ requisition, line }) => ({
        requisitionId: requisition.id,
        requisitionNumber: requisition.requisitionNumber,
        lineNumber: line.lineNumber,
        description: line.description,
        neededBy: line.neededBy ?? requisition.neededBy,
        remainingQuantity: line.remainingQuantity,
      })),
    }),
  );

  router.get("/requisitions/by-number/:requisitionNumber", (req) =>
    jsonOk(
      requisitionService.getByNumber(req.ctx.tenantId, req.params.requisitionNumber).toJSON(),
    ),
  );

  router.get("/requisitions/:requisitionId", (req) =>
    jsonOk(requisitionService.get(req.ctx.tenantId, ulidParam(req.params, "requisitionId")).toJSON()),
  );

  router.post("/requisitions/:requisitionId/lines", (req) => {
    const requisitionId = ulidParam(req.params, "requisitionId");
    const requisition = requisitionService.get(req.ctx.tenantId, requisitionId);
    const line = requisitionService.addLine(
      req.ctx.tenantId,
      requisitionId,
      parseLine(asRecord(req.body), requisition.currency),
    );
    return created(line.toJSON());
  });

  router.patch("/requisitions/:requisitionId/lines/:lineId", (req) => {
    const requisitionId = ulidParam(req.params, "requisitionId");
    const requisition = requisitionService.get(req.ctx.tenantId, requisitionId);
    const body = asRecord(req.body);
    const estimatedUnitPrice: Money | undefined = optMinorPrice(
      body,
      "unitPriceMinor",
      requisition.currency,
    );
    const line = requisitionService.updateLine(
      req.ctx.tenantId,
      requisitionId,
      ulidParam(req.params, "lineId"),
      {
        description: optStr(body, "description"),
        quantity: optNum(body, "quantity"),
        estimatedUnitPrice,
        neededBy: optDateField(body, "neededBy"),
        categoryCode: optStr(body, "categoryCode"),
        suggestedSupplierId: optUlid(body, "suggestedSupplierId"),
        notes: optStr(body, "notes"),
      },
    );
    return jsonOk(line.toJSON());
  });

  router.delete("/requisitions/:requisitionId/lines/:lineId", (req) => {
    requisitionService.removeLine(
      req.ctx.tenantId,
      ulidParam(req.params, "requisitionId"),
      ulidParam(req.params, "lineId"),
    );
    return noContent();
  });

  router.post("/requisitions/:requisitionId/lines/:lineId/cancel", (req) => {
    const body = asRecord(req.body);
    const line = requisitionService.cancelLine(
      req.ctx.tenantId,
      ulidParam(req.params, "requisitionId"),
      ulidParam(req.params, "lineId"),
      str(body, "reason"),
    );
    return jsonOk(line.toJSON());
  });

  router.post("/requisitions/:requisitionId/submit", (req) => {
    const body = asOptionalRecord(req.body);
    const requisition = requisitionService.submit(
      req.ctx.tenantId,
      ulidParam(req.params, "requisitionId"),
      optStr(body, "policyCode"),
    );
    const approval = requisition.approvalRequestId
      ? module.approvalService.get(req.ctx.tenantId, requisition.approvalRequestId).toJSON()
      : undefined;
    return jsonOk({ requisition: requisition.toJSON(), approval });
  });

  router.post("/requisitions/:requisitionId/withdraw", (req) => {
    const body = asRecord(req.body);
    const requisition = requisitionService.withdraw(
      req.ctx.tenantId,
      ulidParam(req.params, "requisitionId"),
      str(body, "reason"),
    );
    return jsonOk(requisition.toJSON());
  });

  router.post("/requisitions/:requisitionId/close", (req) => {
    const body = asRecord(req.body);
    const requisition = requisitionService.close(
      req.ctx.tenantId,
      ulidParam(req.params, "requisitionId"),
      str(body, "reason"),
    );
    return jsonOk(requisition.toJSON());
  });

  router.post("/requisitions/:requisitionId/cancel", (req) => {
    const body = asRecord(req.body);
    const requisition = requisitionService.cancel(
      req.ctx.tenantId,
      ulidParam(req.params, "requisitionId"),
      str(body, "reason"),
    );
    return jsonOk(requisition.toJSON());
  });
}

import type { ContractType, PayFrequency } from "../../domain/employment-contract.js";
import type { RequisitionStatus } from "../../domain/requisition.js";
import type { HcmModule } from "../../module.js";
import {
  actorId,
  asRecord,
  dateField,
  enumField,
  moneyField,
  optDateField,
  optEnumField,
  optInt,
  optMoneyField,
  optNum,
  optStr,
  optUlid,
  requireRole,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

const STATUSES: readonly RequisitionStatus[] = [
  "draft",
  "pending_approval",
  "open",
  "on_hold",
  "filled",
  "cancelled",
];
const CONTRACT_TYPES: readonly ContractType[] = ["permanent", "fixed_term", "contractor", "intern"];
const PAY_FREQUENCIES: readonly PayFrequency[] = ["monthly", "biweekly", "weekly"];

export function registerRequisitionRoutes(router: Router, module: HcmModule): void {
  const { requisitionService } = module;

  router.post("/requisitions", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    const body = asRecord(req.body);
    const min = optMoneyField(body, "salaryBandMin");
    const max = optMoneyField(body, "salaryBandMax");
    const requisition = requisitionService.createDraft(req.ctx.tenantId, {
      positionId: ulidField(body, "positionId"),
      title: optStr(body, "title"),
      headcount: optInt(body, "headcount"),
      hiringManagerId: ulidField(body, "hiringManagerId"),
      recruiterId: optUlid(body, "recruiterId"),
      justification: str(body, "justification"),
      salaryBand: min && max ? { min, max } : undefined,
      targetStartDate: optDateField(body, "targetStartDate"),
    });
    return created(requisition.toJSON());
  });

  router.get("/requisitions", (req) => {
    const statusParam = req.query.get("status");
    const status =
      statusParam && STATUSES.includes(statusParam as RequisitionStatus)
        ? (statusParam as RequisitionStatus)
        : undefined;
    return jsonOk({
      items: requisitionService.listRequisitions(req.ctx.tenantId, status).map((r) => r.toJSON()),
    });
  });

  router.get("/requisitions/:id", (req) =>
    jsonOk(requisitionService.getRequisition(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.post("/requisitions/:id/submit", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    return jsonOk(
      requisitionService.submitForApproval(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON(),
    );
  });

  router.post("/requisitions/:id/approve", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body ?? {});
    return jsonOk(
      requisitionService
        .approve(req.ctx.tenantId, ulidParam(req.params, "id"), actorId(req.ctx), optStr(body, "comment"))
        .toJSON(),
    );
  });

  router.post("/requisitions/:id/reject", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    return jsonOk(
      requisitionService
        .reject(req.ctx.tenantId, ulidParam(req.params, "id"), actorId(req.ctx), str(body, "comment"))
        .toJSON(),
    );
  });

  router.post("/requisitions/:id/hold", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    const body = asRecord(req.body);
    return jsonOk(
      requisitionService.hold(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "note")).toJSON(),
    );
  });

  router.post("/requisitions/:id/resume", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    return jsonOk(requisitionService.resume(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
  });

  router.post("/requisitions/:id/cancel", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    const body = asRecord(req.body);
    return jsonOk(
      requisitionService.cancel(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "note")).toJSON(),
    );
  });

  router.post("/requisitions/:id/fill", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const employeeBody = asRecord(body.employee);
    const contractBody = asRecord(body.contract);
    const result = requisitionService.fill(req.ctx.tenantId, ulidParam(req.params, "id"), {
      positionId: optUlid(body, "positionId"),
      recordedBy: actorId(req.ctx),
      employee: {
        employeeNumber: str(employeeBody, "employeeNumber"),
        firstName: str(employeeBody, "firstName"),
        lastName: str(employeeBody, "lastName"),
        email: str(employeeBody, "email"),
        hireDate: dateField(employeeBody, "hireDate"),
      },
      contract: {
        contractType: enumField(contractBody, "contractType", CONTRACT_TYPES),
        startDate: dateField(contractBody, "startDate"),
        endDate: optDateField(contractBody, "endDate"),
        probationEndDate: optDateField(contractBody, "probationEndDate"),
        fte: optNum(contractBody, "fte"),
        weeklyHours: optNum(contractBody, "weeklyHours"),
        baseSalary: moneyField(contractBody, "baseSalary"),
        payFrequency: optEnumField(contractBody, "payFrequency", PAY_FREQUENCIES),
      },
    });
    return created({
      requisition: result.requisition.toJSON(),
      employee: result.employee.toJSON(),
      contract: result.contract.toJSON(),
    });
  });
}

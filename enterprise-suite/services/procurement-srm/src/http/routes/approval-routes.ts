import {
  APPROVAL_REQUEST_STATUSES,
  type ApprovalRuleInput,
  type ApprovalStepSpec,
} from "../../domain/approval.js";
import { DOCUMENT_TYPES } from "../../domain/common.js";
import type { ProcurementModule } from "../../module.js";
import {
  actorId,
  actorRoles,
  arrayOf,
  asOptionalRecord,
  asRecord,
  bool,
  enumField,
  int,
  optArrayOf,
  optBool,
  optInt,
  optStr,
  optStrList,
  optUlid,
  optUlidList,
  queryEnum,
  queryStr,
  queryUlid,
  requireRole,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

function parseStep(record: Record<string, unknown>, index: number): ApprovalStepSpec {
  return {
    sequence: optInt(record, "sequence") ?? index + 1,
    name: str(record, "name"),
    roleCode: str(record, "roleCode"),
    approverIds: optUlidList(record, "approverIds"),
    quorum: optInt(record, "quorum"),
    slaHours: optInt(record, "slaHours"),
    escalationRoleCode: optStr(record, "escalationRoleCode"),
    allowSelfApproval: optBool(record, "allowSelfApproval"),
  };
}

function parseRule(record: Record<string, unknown>): ApprovalRuleInput {
  return {
    code: str(record, "code"),
    description: optStr(record, "description"),
    minAmountMinor: int(record, "minAmountMinor"),
    maxAmountMinor: optInt(record, "maxAmountMinor"),
    categoryCodes: optStrList(record, "categoryCodes"),
    costCenters: optStrList(record, "costCenters"),
    steps: arrayOf(record, "steps", parseStep),
  };
}

/**
 * Approval policies and the running chains. Decisions carry the caller's roles
 * from `x-roles`, so the aggregate — not the transport — decides who may act.
 */
export function registerApprovalRoutes(router: Router, module: ProcurementModule): void {
  const { approvalService } = module;

  // -- policies ---------------------------------------------------------------

  router.post("/approval-policies", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const body = asRecord(req.body);
    const policy = approvalService.createPolicy(req.ctx.tenantId, {
      code: str(body, "code"),
      name: str(body, "name"),
      documentType: enumField(body, "documentType", DOCUMENT_TYPES),
      currency: str(body, "currency"),
      rules: optArrayOf(body, "rules", parseRule),
      active: optBool(body, "active"),
    });
    return created(policy.toJSON());
  });

  /** Conventional amount-banded matrix, so a tenant is usable from day one. */
  router.post("/approval-policies/default", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const body = asRecord(req.body);
    const policy = approvalService.createDefaultPolicy(
      req.ctx.tenantId,
      enumField(body, "documentType", DOCUMENT_TYPES),
      str(body, "currency"),
      optStr(body, "policyCode"),
    );
    return created(policy.toJSON());
  });

  router.get("/approval-policies", (req) =>
    jsonOk({
      items: approvalService
        .listPolicies(req.ctx.tenantId, queryEnum(req.query, "documentType", DOCUMENT_TYPES))
        .map((policy) => policy.toJSON()),
    }),
  );

  router.get("/approval-policies/:policyCode", (req) =>
    jsonOk(approvalService.getPolicy(req.ctx.tenantId, req.params.policyCode).toJSON()),
  );

  router.post("/approval-policies/:policyCode/rules", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const rule = approvalService.addRule(
      req.ctx.tenantId,
      req.params.policyCode,
      parseRule(asRecord(req.body)),
    );
    return created(rule);
  });

  router.delete("/approval-policies/:policyCode/rules/:ruleCode", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const policy = approvalService.removeRule(
      req.ctx.tenantId,
      req.params.policyCode,
      req.params.ruleCode,
    );
    return jsonOk(policy.toJSON());
  });

  router.post("/approval-policies/:policyCode/active", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const body = asRecord(req.body);
    const policy = approvalService.setPolicyActive(
      req.ctx.tenantId,
      req.params.policyCode,
      bool(body, "active"),
    );
    return jsonOk(policy.toJSON());
  });

  // -- requests ---------------------------------------------------------------

  router.get("/approval-requests", (req) =>
    jsonOk({
      items: approvalService
        .list(req.ctx.tenantId, queryEnum(req.query, "status", APPROVAL_REQUEST_STATUSES))
        .map((request) => request.toJSON()),
    }),
  );

  /**
   * The approver's inbox. Without filters it answers "what can I decide?" from
   * the caller's own roles and id.
   */
  router.get("/approval-requests/inbox", (req) => {
    const rolesFilter = queryStr(req.query, "roles");
    const approverId = queryUlid(req.query, "approverId") ?? actorId(req.ctx);
    const roles = rolesFilter ? rolesFilter.split(",").filter(Boolean) : actorRoles(req.ctx);
    return jsonOk({
      items: approvalService
        .listPending(req.ctx.tenantId, { roles, approverId })
        .map((request) => request.toJSON()),
    });
  });

  router.get("/approval-requests/overdue", (req) =>
    jsonOk({ items: approvalService.overdue(req.ctx.tenantId).map((r) => r.toJSON()) }),
  );

  router.get("/approval-requests/for-document/:documentId", (req) =>
    jsonOk({
      items: approvalService
        .listForDocument(req.ctx.tenantId, ulidParam(req.params, "documentId"))
        .map((request) => request.toJSON()),
    }),
  );

  router.get("/approval-requests/:requestId", (req) =>
    jsonOk(approvalService.get(req.ctx.tenantId, ulidParam(req.params, "requestId")).toJSON()),
  );

  router.post("/approval-requests/:requestId/approve", (req) => {
    const body = asOptionalRecord(req.body);
    const request = approvalService.approve(
      req.ctx.tenantId,
      ulidParam(req.params, "requestId"),
      {
        approverId: optUlid(body, "approverId") ?? actorId(req.ctx),
        roles: optStrList(body, "roles") ?? actorRoles(req.ctx),
        comment: optStr(body, "comment"),
        onBehalfOf: optUlid(body, "onBehalfOf"),
      },
    );
    return jsonOk(request.toJSON());
  });

  router.post("/approval-requests/:requestId/reject", (req) => {
    const body = asRecord(req.body);
    const request = approvalService.reject(req.ctx.tenantId, ulidParam(req.params, "requestId"), {
      approverId: optUlid(body, "approverId") ?? actorId(req.ctx),
      roles: optStrList(body, "roles") ?? actorRoles(req.ctx),
      reason: str(body, "reason"),
    });
    return jsonOk(request.toJSON());
  });

  router.post("/approval-requests/:requestId/delegate", (req) => {
    const body = asRecord(req.body);
    const request = approvalService.delegate(req.ctx.tenantId, ulidParam(req.params, "requestId"), {
      fromApproverId: optUlid(body, "fromApproverId") ?? actorId(req.ctx),
      toApproverId: ulidField(body, "toApproverId"),
      roles: optStrList(body, "roles") ?? actorRoles(req.ctx),
      reason: str(body, "reason"),
    });
    return jsonOk(request.toJSON());
  });

  router.post("/approval-requests/:requestId/escalate", (req) => {
    const body = asRecord(req.body);
    const request = approvalService.escalate(req.ctx.tenantId, ulidParam(req.params, "requestId"), {
      reason: str(body, "reason"),
      force: optBool(body, "force"),
    });
    return jsonOk(request.toJSON());
  });

  router.post("/approval-requests/:requestId/cancel", (req) => {
    const body = asRecord(req.body);
    const request = approvalService.cancel(
      req.ctx.tenantId,
      ulidParam(req.params, "requestId"),
      str(body, "reason"),
    );
    return jsonOk(request.toJSON());
  });

  /** Timer-driven SLA sweep; returns the chains that moved on. */
  router.post("/approval-requests/sweep-overdue", (req) => {
    requireRole(req.ctx, "procurement_admin");
    const body = asOptionalRecord(req.body);
    const escalated = approvalService.sweepOverdue(req.ctx.tenantId, optStr(body, "reason"));
    return jsonOk({ escalated: escalated.length, items: escalated.map((r) => r.toJSON()) });
  });
}

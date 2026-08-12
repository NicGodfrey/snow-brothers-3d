import {
  NotFoundError,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  ApprovalPolicy,
  ApprovalRequest,
  defaultApprovalRules,
  type ApprovalRequestStatus,
  type ApprovalRule,
  type ApprovalRuleInput,
} from "../domain/approval.js";
import { code, type DocumentType } from "../domain/common.js";
import { ApprovalError } from "../domain/errors.js";
import {
  commit,
  type ApprovalPolicyRepository,
  type ApprovalRequestRepository,
  type Clock,
  type EventOutbox,
} from "./ports.js";

export interface ApprovalOutcome {
  readonly tenantId: TenantId;
  readonly request: ApprovalRequest;
  readonly outcome: "approved" | "rejected";
  readonly reason?: string;
}

/**
 * Invoked once an approval chain finishes. Document services register one of
 * these instead of the approval engine importing them, which keeps the
 * dependency arrow pointing one way.
 */
export type ApprovalOutcomeHandler = (outcome: ApprovalOutcome) => void;

export interface RequestApprovalInput {
  documentType: DocumentType;
  documentId: Ulid;
  documentNumber: string;
  amount: Money;
  requestedBy: Ulid;
  categoryCodes?: readonly string[];
  costCenter?: string;
  /** Forces a specific policy; otherwise the matching active one is used. */
  policyCode?: string;
  context?: Record<string, unknown>;
}

/**
 * Owns approval policies and the running approval chains for every document
 * type in this context.
 */
export class ApprovalService {
  private readonly handlers = new Map<DocumentType, ApprovalOutcomeHandler[]>();

  constructor(
    private readonly policies: ApprovalPolicyRepository,
    private readonly requests: ApprovalRequestRepository,
    private readonly outbox: EventOutbox,
    private readonly clock: Clock,
  ) {}

  // -- policies -------------------------------------------------------------

  createPolicy(
    tenantId: TenantId,
    input: {
      code: string;
      name: string;
      documentType: DocumentType;
      currency: string;
      rules?: readonly ApprovalRuleInput[];
      active?: boolean;
    },
  ): ApprovalPolicy {
    const policyCode = code(input.code, "code");
    if (this.policies.findByCode(tenantId, policyCode)) {
      throw new ApprovalError(`Approval policy ${policyCode} already exists`, "POLICY_EXISTS", 409);
    }
    const policy = ApprovalPolicy.create(tenantId, { ...input, code: policyCode });
    return commit(this.policies, this.outbox, policy);
  }

  /** Creates the conventional amount-banded matrix for a document type. */
  createDefaultPolicy(
    tenantId: TenantId,
    documentType: DocumentType,
    currency: string,
    policyCode = `${documentType.toUpperCase()}_DEFAULT`,
  ): ApprovalPolicy {
    return this.createPolicy(tenantId, {
      code: policyCode,
      name: `Default ${documentType.replace("_", " ")} approvals`,
      documentType,
      currency,
      rules: defaultApprovalRules(currency),
    });
  }

  addRule(tenantId: TenantId, policyCode: string, rule: ApprovalRuleInput): ApprovalRule {
    const policy = this.getPolicy(tenantId, policyCode);
    const added = policy.addRule(rule);
    commit(this.policies, this.outbox, policy);
    return added;
  }

  removeRule(tenantId: TenantId, policyCode: string, ruleCode: string): ApprovalPolicy {
    const policy = this.getPolicy(tenantId, policyCode);
    policy.removeRule(ruleCode);
    return commit(this.policies, this.outbox, policy);
  }

  getPolicy(tenantId: TenantId, policyCode: string): ApprovalPolicy {
    const policy = this.policies.findByCode(tenantId, code(policyCode, "code"));
    if (!policy) throw new NotFoundError("ApprovalPolicy", policyCode);
    return policy;
  }

  listPolicies(tenantId: TenantId, documentType?: DocumentType): ApprovalPolicy[] {
    const all = documentType
      ? this.policies.listByDocumentType(tenantId, documentType)
      : this.policies.listByTenant(tenantId);
    return all.sort((a, b) => a.code.localeCompare(b.code));
  }

  setPolicyActive(tenantId: TenantId, policyCode: string, active: boolean): ApprovalPolicy {
    const policy = this.getPolicy(tenantId, policyCode);
    if (active) policy.activate();
    else policy.deactivate();
    return commit(this.policies, this.outbox, policy);
  }

  // -- outcome subscribers --------------------------------------------------

  onOutcome(documentType: DocumentType, handler: ApprovalOutcomeHandler): () => void {
    const existing = this.handlers.get(documentType) ?? [];
    existing.push(handler);
    this.handlers.set(documentType, existing);
    return () => {
      const handlers = this.handlers.get(documentType) ?? [];
      const index = handlers.indexOf(handler);
      if (index >= 0) handlers.splice(index, 1);
    };
  }

  // -- requests -------------------------------------------------------------

  /**
   * Opens an approval chain for a document. When the matched rule has no
   * steps the request is born approved and subscribers fire immediately, which
   * is how low-value spend is auto-approved.
   */
  requestApproval(tenantId: TenantId, input: RequestApprovalInput): ApprovalRequest {
    const { policy, rule } = this.resolvePolicy(tenantId, input);
    const request = ApprovalRequest.open(tenantId, {
      documentType: input.documentType,
      documentId: input.documentId,
      documentNumber: input.documentNumber,
      amount: input.amount,
      requestedBy: input.requestedBy,
      policyCode: policy.code,
      rule,
      now: this.clock.now(),
      context: input.context,
    });
    commit(this.requests, this.outbox, request);
    if (request.status !== "pending") this.notify(tenantId, request);
    return request;
  }

  get(tenantId: TenantId, requestId: Ulid): ApprovalRequest {
    const request = this.requests.findById(tenantId, requestId);
    if (!request) throw new NotFoundError("ApprovalRequest", requestId);
    return request;
  }

  listForDocument(tenantId: TenantId, documentId: Ulid): ApprovalRequest[] {
    return this.requests.findByDocument(tenantId, documentId);
  }

  /** The live request for a document, if one is still running. */
  pendingForDocument(tenantId: TenantId, documentId: Ulid): ApprovalRequest | undefined {
    return this.requests
      .findByDocument(tenantId, documentId)
      .find((request) => request.status === "pending");
  }

  list(tenantId: TenantId, status?: ApprovalRequestStatus): ApprovalRequest[] {
    return status ? this.requests.listByStatus(tenantId, status) : this.requests.listByTenant(tenantId);
  }

  listPending(
    tenantId: TenantId,
    filters: { roles?: readonly string[]; approverId?: Ulid },
  ): ApprovalRequest[] {
    if (filters.approverId) {
      const byApprover = this.requests.listPendingForApprover(tenantId, filters.approverId);
      if (!filters.roles || filters.roles.length === 0) return byApprover;
      const byRole = this.requests.listPendingForRoles(tenantId, filters.roles);
      const seen = new Set(byApprover.map((request) => request.id));
      return [...byApprover, ...byRole.filter((request) => !seen.has(request.id))];
    }
    if (filters.roles && filters.roles.length > 0) {
      return this.requests.listPendingForRoles(tenantId, filters.roles);
    }
    return this.requests.listByStatus(tenantId, "pending");
  }

  approve(
    tenantId: TenantId,
    requestId: Ulid,
    input: { approverId: Ulid; roles: readonly string[]; comment?: string; onBehalfOf?: Ulid },
  ): ApprovalRequest {
    const request = this.get(tenantId, requestId);
    request.approve({
      approverId: input.approverId,
      roles: input.roles,
      now: this.clock.now(),
      comment: input.comment,
      onBehalfOf: input.onBehalfOf,
    });
    commit(this.requests, this.outbox, request);
    if (request.status !== "pending") this.notify(tenantId, request);
    return request;
  }

  reject(
    tenantId: TenantId,
    requestId: Ulid,
    input: { approverId: Ulid; roles: readonly string[]; reason: string },
  ): ApprovalRequest {
    const request = this.get(tenantId, requestId);
    request.reject({
      approverId: input.approverId,
      roles: input.roles,
      now: this.clock.now(),
      reason: input.reason,
    });
    commit(this.requests, this.outbox, request);
    this.notify(tenantId, request);
    return request;
  }

  delegate(
    tenantId: TenantId,
    requestId: Ulid,
    input: { fromApproverId: Ulid; toApproverId: Ulid; roles: readonly string[]; reason: string },
  ): ApprovalRequest {
    const request = this.get(tenantId, requestId);
    request.delegate({ ...input, now: this.clock.now() });
    return commit(this.requests, this.outbox, request);
  }

  escalate(
    tenantId: TenantId,
    requestId: Ulid,
    input: { reason: string; force?: boolean },
  ): ApprovalRequest {
    const request = this.get(tenantId, requestId);
    request.escalate({ now: this.clock.now(), reason: input.reason, force: input.force });
    return commit(this.requests, this.outbox, request);
  }

  cancel(tenantId: TenantId, requestId: Ulid, reason: string): ApprovalRequest {
    const request = this.get(tenantId, requestId);
    request.cancel(reason);
    return commit(this.requests, this.outbox, request);
  }

  /** Cancels the live request for a document (withdrawal, order cancellation). */
  cancelForDocument(tenantId: TenantId, documentId: Ulid, reason: string): ApprovalRequest | undefined {
    const request = this.pendingForDocument(tenantId, documentId);
    if (!request) return undefined;
    request.cancel(reason);
    return commit(this.requests, this.outbox, request);
  }

  /**
   * Escalates every pending step past its SLA. Intended to run on a timer;
   * returns the requests that moved so the caller can notify approvers.
   */
  sweepOverdue(tenantId: TenantId, reason = "SLA breached"): ApprovalRequest[] {
    const now = this.clock.now();
    const escalated: ApprovalRequest[] = [];
    for (const request of this.requests.listByStatus(tenantId, "pending")) {
      const step = request.currentStep;
      if (!step || !step.isOverdue(now) || step.escalatedAt || !step.escalationRoleCode) continue;
      request.escalate({ now, reason });
      commit(this.requests, this.outbox, request);
      escalated.push(request);
    }
    return escalated;
  }

  /** Requests whose current step is past its SLA, for dashboards. */
  overdue(tenantId: TenantId): ApprovalRequest[] {
    const now = this.clock.now();
    return this.requests
      .listByStatus(tenantId, "pending")
      .filter((request) => request.currentStep?.isOverdue(now) === true);
  }

  // -- internals ------------------------------------------------------------

  private resolvePolicy(
    tenantId: TenantId,
    input: RequestApprovalInput,
  ): { policy: ApprovalPolicy; rule: ApprovalRule } {
    const criteria = {
      amount: input.amount,
      categoryCodes: input.categoryCodes,
      costCenter: input.costCenter,
    };
    if (input.policyCode) {
      const policy = this.getPolicy(tenantId, input.policyCode);
      const rule = policy.selectRule(criteria);
      if (!rule) {
        throw new ApprovalError(
          `Policy ${policy.code} has no rule covering ${input.amount.amountMinor} ${input.amount.currency}`,
          "NO_MATCHING_RULE",
          422,
        );
      }
      return { policy, rule };
    }
    const candidates = this.policies
      .listByDocumentType(tenantId, input.documentType)
      .filter((policy) => policy.active && policy.currency === input.amount.currency)
      .sort((a, b) => a.code.localeCompare(b.code));
    for (const policy of candidates) {
      const rule = policy.selectRule(criteria);
      if (rule) return { policy, rule };
    }
    throw new ApprovalError(
      `No active ${input.documentType} approval policy covers ${input.amount.amountMinor} ${input.amount.currency}`,
      "NO_APPROVAL_POLICY",
      422,
      { documentType: input.documentType, amount: input.amount },
    );
  }

  private notify(tenantId: TenantId, request: ApprovalRequest): void {
    if (request.status !== "approved" && request.status !== "rejected") return;
    const handlers = this.handlers.get(request.documentType) ?? [];
    for (const handler of handlers) {
      handler({
        tenantId,
        request,
        outcome: request.status,
        reason: request.rejectionReason,
      });
    }
  }
}

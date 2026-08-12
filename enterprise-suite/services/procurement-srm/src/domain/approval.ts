import {
  AggregateRoot,
  brand,
  envelope,
  money,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { code, currencyCode, requiredText, type DocumentType } from "./common.js";
import { ApprovalError, InvalidStateError, invariant, ValidationError } from "./errors.js";
import { ProcurementEvents } from "./events.js";

export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ApprovalStepStatus = "pending" | "approved" | "rejected" | "skipped";

export interface ApprovalStepSpec {
  /** 1-based order in the chain; steps run strictly in sequence. */
  readonly sequence: number;
  readonly name: string;
  /** Role that may decide this step (`x-roles` header value). */
  readonly roleCode: string;
  /** Named approvers that may decide regardless of role. */
  readonly approverIds?: readonly Ulid[];
  /** Number of distinct approvals needed before the step completes. */
  readonly quorum?: number;
  readonly slaHours?: number;
  readonly escalationRoleCode?: string;
  /** Allows the document requester to also approve this step. */
  readonly allowSelfApproval?: boolean;
}

export interface ApprovalRuleInput {
  code: string;
  description?: string;
  /** Inclusive lower bound of the amount band, in minor units. */
  minAmountMinor: number;
  /** Exclusive upper bound; omitted means "and above". */
  maxAmountMinor?: number;
  categoryCodes?: readonly string[];
  costCenters?: readonly string[];
  /** An empty chain auto-approves documents that match the rule. */
  steps: readonly ApprovalStepSpec[];
}

export interface ApprovalRule {
  readonly code: string;
  readonly description: string;
  readonly minAmountMinor: number;
  readonly maxAmountMinor?: number;
  readonly categoryCodes?: readonly string[];
  readonly costCenters?: readonly string[];
  readonly steps: readonly ApprovalStepSpec[];
}

export interface ApprovalCriteria {
  readonly amount: Money;
  readonly categoryCodes?: readonly string[];
  readonly costCenter?: string;
}

export interface ApprovalPolicyProps {
  code: string;
  name: string;
  documentType: DocumentType;
  currency: string;
  active: boolean;
  rules: ApprovalRule[];
}

function normalizeStep(step: ApprovalStepSpec): ApprovalStepSpec {
  invariant(
    Number.isInteger(step.sequence) && step.sequence >= 1,
    "sequence",
    "must be an integer >= 1",
  );
  const quorum = step.quorum ?? 1;
  invariant(Number.isInteger(quorum) && quorum >= 1 && quorum <= 10, "quorum", "must be within [1, 10]");
  if (step.approverIds && step.approverIds.length > 0 && quorum > step.approverIds.length) {
    throw ValidationError.single(
      "quorum",
      `cannot exceed the ${step.approverIds.length} named approvers on step ${step.sequence}`,
    );
  }
  const slaHours = step.slaHours ?? 48;
  invariant(
    Number.isInteger(slaHours) && slaHours >= 1 && slaHours <= 24 * 30,
    "slaHours",
    "must be within [1, 720]",
  );
  return {
    sequence: step.sequence,
    name: requiredText(step.name, "name", 2, 80),
    roleCode: code(step.roleCode, "roleCode").toLowerCase(),
    approverIds: step.approverIds ? [...step.approverIds] : undefined,
    quorum,
    slaHours,
    escalationRoleCode: step.escalationRoleCode
      ? code(step.escalationRoleCode, "escalationRoleCode").toLowerCase()
      : undefined,
    allowSelfApproval: step.allowSelfApproval ?? false,
  };
}

/**
 * A tenant's approval matrix for one document type: amount-banded rules, each
 * carrying an ordered chain of steps. Rule selection prefers the most specific
 * match (category + cost centre filters beat a plain amount band), so a
 * catch-all band can coexist with targeted exceptions.
 */
export class ApprovalPolicy extends AggregateRoot<ApprovalPolicyProps> {
  private constructor(tenantId: TenantId, props: ApprovalPolicyProps) {
    super(tenantId, props);
  }

  static create(
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
    const policy = new ApprovalPolicy(tenantId, {
      code: code(input.code, "code"),
      name: requiredText(input.name, "name", 2, 120),
      documentType: input.documentType,
      currency: currencyCode(input.currency),
      active: input.active ?? true,
      rules: [],
    });
    for (const rule of input.rules ?? []) policy.addRule(rule);
    policy.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalPolicyPublished,
        aggregateType: "ApprovalPolicy",
        aggregateId: policy.id,
        tenantId,
        payload: {
          policyId: policy.id,
          policyCode: policy.props.code,
          documentType: policy.props.documentType,
          ruleCount: policy.props.rules.length,
        },
      }),
    );
    return policy;
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get documentType(): DocumentType {
    return this.props.documentType;
  }
  get currency(): string {
    return this.props.currency;
  }
  get active(): boolean {
    return this.props.active;
  }
  get rules(): readonly ApprovalRule[] {
    return this.props.rules;
  }

  addRule(input: ApprovalRuleInput): ApprovalRule {
    const ruleCode = code(input.code, "code");
    if (this.props.rules.some((rule) => rule.code === ruleCode)) {
      throw ValidationError.single("code", `rule ${ruleCode} already exists on policy ${this.props.code}`);
    }
    invariant(
      Number.isInteger(input.minAmountMinor) && input.minAmountMinor >= 0,
      "minAmountMinor",
      "must be a non-negative integer",
    );
    if (input.maxAmountMinor !== undefined) {
      invariant(
        Number.isInteger(input.maxAmountMinor) && input.maxAmountMinor > input.minAmountMinor,
        "maxAmountMinor",
        `must be an integer greater than minAmountMinor (${input.minAmountMinor})`,
      );
    }
    const steps = [...input.steps]
      .map(normalizeStep)
      .sort((a, b) => a.sequence - b.sequence);
    const sequences = new Set(steps.map((step) => step.sequence));
    if (sequences.size !== steps.length) {
      throw ValidationError.single("steps", "step sequences must be unique within a rule");
    }
    const rule: ApprovalRule = {
      code: ruleCode,
      description: input.description ?? ruleCode,
      minAmountMinor: input.minAmountMinor,
      maxAmountMinor: input.maxAmountMinor,
      categoryCodes: input.categoryCodes?.map((c) => code(c, "categoryCode")),
      costCenters: input.costCenters?.map((c) => code(c, "costCenter")),
      steps,
    };
    this.props.rules.push(rule);
    this.props.rules.sort((a, b) => a.minAmountMinor - b.minAmountMinor);
    this.touch();
    return rule;
  }

  removeRule(ruleCode: string): void {
    const normalized = code(ruleCode, "code");
    const index = this.props.rules.findIndex((rule) => rule.code === normalized);
    if (index < 0) throw ValidationError.single("code", `rule ${normalized} is not on this policy`);
    this.props.rules.splice(index, 1);
    this.touch();
  }

  activate(): void {
    this.props.active = true;
    this.touch();
  }

  deactivate(): void {
    this.props.active = false;
    this.touch();
  }

  /**
   * Picks the winning rule for a document. Specificity beats breadth: a rule
   * naming the document's category and cost centre wins over one that only
   * bands on amount; ties break toward the narrower amount band.
   */
  selectRule(criteria: ApprovalCriteria): ApprovalRule | undefined {
    if (!this.props.active) return undefined;
    if (criteria.amount.currency !== this.props.currency) {
      throw new ApprovalError(
        `Policy ${this.props.code} is denominated in ${this.props.currency}, document is ${criteria.amount.currency}`,
        "POLICY_CURRENCY_MISMATCH",
        422,
      );
    }
    const amount = criteria.amount.amountMinor;
    const candidates = this.props.rules
      .filter((rule) => amount >= rule.minAmountMinor)
      .filter((rule) => rule.maxAmountMinor === undefined || amount < rule.maxAmountMinor)
      .filter((rule) => {
        if (!rule.categoryCodes || rule.categoryCodes.length === 0) return true;
        const categories = criteria.categoryCodes ?? [];
        return categories.some((category) => rule.categoryCodes?.includes(category));
      })
      .filter((rule) => {
        if (!rule.costCenters || rule.costCenters.length === 0) return true;
        return criteria.costCenter !== undefined && rule.costCenters.includes(criteria.costCenter);
      });
    if (candidates.length === 0) return undefined;
    return candidates.sort((a, b) => specificity(b) - specificity(a) || b.minAmountMinor - a.minAmountMinor)[0];
  }

}

function specificity(rule: ApprovalRule): number {
  let score = 0;
  if (rule.categoryCodes && rule.categoryCodes.length > 0) score += 2;
  if (rule.costCenters && rule.costCenters.length > 0) score += 1;
  return score;
}

export interface ApprovalDecisionRecord {
  readonly approverId: Ulid;
  readonly decision: "approved" | "rejected";
  readonly decidedAt: IsoDateTime;
  readonly comment?: string;
  readonly onBehalfOf?: Ulid;
}

export interface ApprovalDelegation {
  readonly fromApproverId: Ulid;
  readonly toApproverId: Ulid;
  readonly reason: string;
  readonly delegatedAt: IsoDateTime;
}

/** One rung of an approval chain, with quorum, SLA and delegation tracking. */
export class ApprovalStep {
  readonly id: Ulid;
  readonly sequence: number;
  readonly name: string;
  roleCode: string;
  readonly approverIds: Ulid[];
  readonly quorum: number;
  readonly slaHours: number;
  readonly escalationRoleCode?: string;
  readonly allowSelfApproval: boolean;
  status: ApprovalStepStatus;
  readonly decisions: ApprovalDecisionRecord[];
  readonly delegations: ApprovalDelegation[];
  dueAt?: IsoDateTime;
  escalatedAt?: IsoDateTime;
  escalationReason?: string;

  constructor(spec: ApprovalStepSpec) {
    const normalized = normalizeStep(spec);
    this.id = newId("apstep");
    this.sequence = normalized.sequence;
    this.name = normalized.name;
    this.roleCode = normalized.roleCode;
    this.approverIds = [...(normalized.approverIds ?? [])];
    this.quorum = normalized.quorum ?? 1;
    this.slaHours = normalized.slaHours ?? 48;
    this.escalationRoleCode = normalized.escalationRoleCode;
    this.allowSelfApproval = normalized.allowSelfApproval ?? false;
    this.status = "pending";
    this.decisions = [];
    this.delegations = [];
  }

  get approvalCount(): number {
    return this.decisions.filter((decision) => decision.decision === "approved").length;
  }

  get remainingApprovals(): number {
    return Math.max(0, this.quorum - this.approvalCount);
  }

  hasDecided(approverId: Ulid): boolean {
    return this.decisions.some((decision) => decision.approverId === approverId);
  }

  mayDecide(approverId: Ulid, roles: readonly string[]): boolean {
    if (this.approverIds.length > 0 && this.approverIds.includes(approverId)) return true;
    const normalizedRoles = roles.map((role) => role.toLowerCase());
    if (normalizedRoles.includes(this.roleCode)) return true;
    if (this.escalatedAt && this.escalationRoleCode && normalizedRoles.includes(this.escalationRoleCode)) {
      return true;
    }
    return false;
  }

  isOverdue(now: IsoDateTime): boolean {
    return this.status === "pending" && this.dueAt !== undefined && now > this.dueAt;
  }

  toJSON(): Record<string, unknown> {
    return {
      id: this.id,
      sequence: this.sequence,
      name: this.name,
      roleCode: this.roleCode,
      approverIds: [...this.approverIds],
      quorum: this.quorum,
      slaHours: this.slaHours,
      escalationRoleCode: this.escalationRoleCode,
      allowSelfApproval: this.allowSelfApproval,
      status: this.status,
      approvalCount: this.approvalCount,
      remainingApprovals: this.remainingApprovals,
      decisions: [...this.decisions],
      delegations: [...this.delegations],
      dueAt: this.dueAt,
      escalatedAt: this.escalatedAt,
      escalationReason: this.escalationReason,
    };
  }
}

export interface ApprovalRequestProps {
  documentType: DocumentType;
  documentId: Ulid;
  documentNumber: string;
  amount: Money;
  requestedBy: Ulid;
  policyCode: string;
  ruleCode: string;
  steps: ApprovalStep[];
  currentStepIndex: number;
  status: ApprovalRequestStatus;
  autoApproved: boolean;
  decidedAt?: IsoDateTime;
  rejectionReason?: string;
  cancellationReason?: string;
  context?: Record<string, unknown>;
}

export type ApprovalRequestView = EntityProps &
  ApprovalRequestProps & {
    currentStep?: ApprovalStep;
    pendingChain: ReadonlyArray<{ sequence: number; name: string; roleCode: string }>;
    approvers: readonly Ulid[];
  };

/**
 * A running approval chain for one document. The document aggregate stays
 * ignorant of who approves what; it only learns the outcome through the
 * `procurement.approval.completed` event / service callback.
 */
export class ApprovalRequest extends AggregateRoot<ApprovalRequestProps> {
  private constructor(tenantId: TenantId, props: ApprovalRequestProps) {
    super(tenantId, props);
  }

  static open(
    tenantId: TenantId,
    input: {
      documentType: DocumentType;
      documentId: Ulid;
      documentNumber: string;
      amount: Money;
      requestedBy: Ulid;
      policyCode: string;
      rule: ApprovalRule;
      now: IsoDateTime;
      context?: Record<string, unknown>;
    },
  ): ApprovalRequest {
    const steps = input.rule.steps.map((spec) => new ApprovalStep(spec));
    const request = new ApprovalRequest(tenantId, {
      documentType: input.documentType,
      documentId: input.documentId,
      documentNumber: input.documentNumber,
      amount: input.amount,
      requestedBy: input.requestedBy,
      policyCode: input.policyCode,
      ruleCode: input.rule.code,
      steps,
      currentStepIndex: 0,
      status: "pending",
      autoApproved: false,
      context: input.context,
    });
    request.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalRequested,
        aggregateType: "ApprovalRequest",
        aggregateId: request.id,
        tenantId,
        payload: {
          approvalRequestId: request.id,
          documentType: input.documentType,
          documentId: input.documentId,
          documentNumber: input.documentNumber,
          amount: input.amount,
          policyCode: input.policyCode,
          ruleCode: input.rule.code,
          stepCount: steps.length,
        },
      }),
    );
    if (steps.length === 0) {
      request.props.autoApproved = true;
      request.complete("approved", input.now);
    } else {
      request.scheduleCurrentStep(input.now);
    }
    return request;
  }

  get documentType(): DocumentType {
    return this.props.documentType;
  }
  get documentId(): Ulid {
    return this.props.documentId;
  }
  get documentNumber(): string {
    return this.props.documentNumber;
  }
  get amount(): Money {
    return this.props.amount;
  }
  get requestedBy(): Ulid {
    return this.props.requestedBy;
  }
  get policyCode(): string {
    return this.props.policyCode;
  }
  get ruleCode(): string {
    return this.props.ruleCode;
  }
  get status(): ApprovalRequestStatus {
    return this.props.status;
  }
  get steps(): readonly ApprovalStep[] {
    return this.props.steps;
  }
  get autoApproved(): boolean {
    return this.props.autoApproved;
  }
  get rejectionReason(): string | undefined {
    return this.props.rejectionReason;
  }

  get currentStep(): ApprovalStep | undefined {
    return this.props.steps[this.props.currentStepIndex];
  }

  get approvers(): readonly Ulid[] {
    return this.props.steps.flatMap((step) =>
      step.decisions.filter((d) => d.decision === "approved").map((d) => d.approverId),
    );
  }

  /** Steps still to be decided, for "who is holding this up" views. */
  get pendingChain(): ReadonlyArray<{ sequence: number; name: string; roleCode: string }> {
    return this.props.steps
      .filter((step) => step.status === "pending")
      .map((step) => ({ sequence: step.sequence, name: step.name, roleCode: step.roleCode }));
  }

  approve(input: {
    approverId: Ulid;
    roles: readonly string[];
    now: IsoDateTime;
    comment?: string;
    onBehalfOf?: Ulid;
  }): void {
    const step = this.assertActionable("approve");
    this.assertEligible(step, input.approverId, input.roles);
    if (step.hasDecided(input.approverId)) {
      throw new ApprovalError(
        `Approver ${input.approverId} has already decided step ${step.sequence}`,
        "DUPLICATE_DECISION",
      );
    }
    step.decisions.push({
      approverId: input.approverId,
      decision: "approved",
      decidedAt: input.now,
      comment: input.comment,
      onBehalfOf: input.onBehalfOf,
    });
    if (step.approvalCount < step.quorum) {
      this.touch();
      return;
    }
    step.status = "approved";
    this.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalStepApproved,
        aggregateType: "ApprovalRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          approvalRequestId: this.id,
          documentType: this.props.documentType,
          documentId: this.props.documentId,
          sequence: step.sequence,
          stepName: step.name,
          approverIds: step.decisions.map((d) => d.approverId),
        },
      }),
    );
    this.props.currentStepIndex += 1;
    if (this.props.currentStepIndex >= this.props.steps.length) {
      this.complete("approved", input.now);
    } else {
      this.scheduleCurrentStep(input.now);
    }
  }

  reject(input: { approverId: Ulid; roles: readonly string[]; now: IsoDateTime; reason: string }): void {
    const step = this.assertActionable("reject");
    this.assertEligible(step, input.approverId, input.roles);
    const reason = requiredText(input.reason, "reason", 3, 500);
    step.decisions.push({
      approverId: input.approverId,
      decision: "rejected",
      decidedAt: input.now,
      comment: reason,
    });
    step.status = "rejected";
    for (const later of this.props.steps.slice(this.props.currentStepIndex + 1)) {
      later.status = "skipped";
    }
    this.props.rejectionReason = reason;
    this.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalStepRejected,
        aggregateType: "ApprovalRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          approvalRequestId: this.id,
          documentType: this.props.documentType,
          documentId: this.props.documentId,
          sequence: step.sequence,
          approverId: input.approverId,
          reason,
        },
      }),
    );
    this.complete("rejected", input.now);
  }

  /**
   * Hands the current step to a stand-in (holiday cover). The delegate joins
   * the named-approver list; the original approver keeps their entitlement.
   */
  delegate(input: {
    fromApproverId: Ulid;
    toApproverId: Ulid;
    roles: readonly string[];
    now: IsoDateTime;
    reason: string;
  }): void {
    const step = this.assertActionable("delegate");
    this.assertEligible(step, input.fromApproverId, input.roles);
    if (input.toApproverId === input.fromApproverId) {
      throw ValidationError.single("toApproverId", "cannot delegate to yourself");
    }
    if (input.toApproverId === this.props.requestedBy && !step.allowSelfApproval) {
      throw new ApprovalError(
        "Cannot delegate approval to the document requester",
        "SELF_APPROVAL",
        403,
      );
    }
    const reason = requiredText(input.reason, "reason", 3, 500);
    step.delegations.push({
      fromApproverId: input.fromApproverId,
      toApproverId: input.toApproverId,
      reason,
      delegatedAt: input.now,
    });
    if (!step.approverIds.includes(input.toApproverId)) step.approverIds.push(input.toApproverId);
    this.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalDelegated,
        aggregateType: "ApprovalRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          approvalRequestId: this.id,
          sequence: step.sequence,
          fromApproverId: input.fromApproverId,
          toApproverId: input.toApproverId,
          reason,
        },
      }),
    );
  }

  /** Opens the current step to its escalation role once the SLA has lapsed. */
  escalate(input: { now: IsoDateTime; reason: string; force?: boolean }): void {
    const step = this.assertActionable("escalate");
    if (!step.escalationRoleCode) {
      throw new ApprovalError(
        `Step ${step.sequence} (${step.name}) has no escalation role configured`,
        "NO_ESCALATION_PATH",
        422,
      );
    }
    if (!input.force && !step.isOverdue(input.now)) {
      throw new ApprovalError(
        `Step ${step.sequence} is not overdue (due ${step.dueAt ?? "n/a"})`,
        "NOT_OVERDUE",
        409,
      );
    }
    step.escalatedAt = input.now;
    step.escalationReason = requiredText(input.reason, "reason", 3, 500);
    this.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalEscalated,
        aggregateType: "ApprovalRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          approvalRequestId: this.id,
          documentType: this.props.documentType,
          documentId: this.props.documentId,
          sequence: step.sequence,
          escalationRoleCode: step.escalationRoleCode,
          reason: step.escalationReason,
        },
      }),
    );
  }

  cancel(reason: string): void {
    if (this.props.status !== "pending") {
      throw InvalidStateError.transition("approval request", "cancel", this.props.status, ["pending"]);
    }
    this.props.status = "cancelled";
    this.props.cancellationReason = requiredText(reason, "reason", 3, 500);
    for (const step of this.props.steps) {
      if (step.status === "pending") step.status = "skipped";
    }
    this.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalCancelled,
        aggregateType: "ApprovalRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          approvalRequestId: this.id,
          documentType: this.props.documentType,
          documentId: this.props.documentId,
          reason: this.props.cancellationReason,
        },
      }),
    );
  }

  overdueSteps(now: IsoDateTime): readonly ApprovalStep[] {
    return this.props.steps.filter((step) => step.isOverdue(now));
  }

  toJSON(): ApprovalRequestView {
    return {
      ...super.toJSON(),
      currentStep: this.currentStep,
      pendingChain: this.pendingChain,
      approvers: this.approvers,
    };
  }

  // -- internals ------------------------------------------------------------

  private assertActionable(action: string): ApprovalStep {
    if (this.props.status !== "pending") {
      throw InvalidStateError.transition("approval request", action, this.props.status, ["pending"]);
    }
    const step = this.currentStep;
    if (!step) {
      throw new InvalidStateError(`Approval request ${this.id} has no pending step`);
    }
    return step;
  }

  private assertEligible(step: ApprovalStep, approverId: Ulid, roles: readonly string[]): void {
    if (approverId === this.props.requestedBy && !step.allowSelfApproval) {
      throw new ApprovalError(
        `${approverId} raised ${this.props.documentNumber} and cannot approve it`,
        "SELF_APPROVAL",
        403,
      );
    }
    if (!step.mayDecide(approverId, roles)) {
      throw new ApprovalError(
        `Step ${step.sequence} (${step.name}) requires role ${step.roleCode}${
          step.approverIds.length > 0 ? " or a named approver" : ""
        }`,
        "NOT_AN_APPROVER",
        403,
        { requiredRole: step.roleCode, namedApprovers: step.approverIds },
      );
    }
  }

  private scheduleCurrentStep(now: IsoDateTime): void {
    const step = this.currentStep;
    if (!step) return;
    step.dueAt = addHours(now, step.slaHours);
    this.touch();
  }

  private complete(outcome: "approved" | "rejected", now: IsoDateTime): void {
    this.props.status = outcome;
    this.props.decidedAt = now;
    this.raise(
      envelope({
        eventType: ProcurementEvents.ApprovalCompleted,
        aggregateType: "ApprovalRequest",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          approvalRequestId: this.id,
          documentType: this.props.documentType,
          documentId: this.props.documentId,
          documentNumber: this.props.documentNumber,
          outcome,
          amount: this.props.amount,
          policyCode: this.props.policyCode,
          decidedBy: this.approvers,
          reason: this.props.rejectionReason,
          autoApproved: this.props.autoApproved,
        },
      }),
    );
  }
}

export function addHours(from: IsoDateTime, hours: number): IsoDateTime {
  const date = new Date(from);
  date.setUTCHours(date.getUTCHours() + hours);
  return brand<string, "IsoDateTime">(date.toISOString());
}

/**
 * A conventional three-band matrix used by fixtures and as the fallback when a
 * tenant has not configured anything: auto-approve small buys, one manager for
 * mid-size, manager + finance for large, plus a CFO rung above the cap.
 */
export function defaultApprovalRules(currency: string): ApprovalRuleInput[] {
  const scale = currency === "JPY" ? 1 : 100;
  return [
    {
      code: "AUTO_SMALL",
      description: "Auto-approve routine spend",
      minAmountMinor: 0,
      maxAmountMinor: 500 * scale,
      steps: [],
    },
    {
      code: "MANAGER",
      description: "Cost-centre manager sign-off",
      minAmountMinor: 500 * scale,
      maxAmountMinor: 10_000 * scale,
      steps: [
        { sequence: 1, name: "Cost centre manager", roleCode: "manager", slaHours: 48, escalationRoleCode: "finance" },
      ],
    },
    {
      code: "MANAGER_FINANCE",
      description: "Manager then finance controller",
      minAmountMinor: 10_000 * scale,
      maxAmountMinor: 100_000 * scale,
      steps: [
        { sequence: 1, name: "Cost centre manager", roleCode: "manager", slaHours: 48, escalationRoleCode: "finance" },
        { sequence: 2, name: "Finance controller", roleCode: "finance", slaHours: 72, escalationRoleCode: "cfo" },
      ],
    },
    {
      code: "EXECUTIVE",
      description: "Manager, finance and CFO for capital spend",
      minAmountMinor: 100_000 * scale,
      steps: [
        { sequence: 1, name: "Cost centre manager", roleCode: "manager", slaHours: 24, escalationRoleCode: "finance" },
        { sequence: 2, name: "Finance controller", roleCode: "finance", slaHours: 48, escalationRoleCode: "cfo" },
        { sequence: 3, name: "CFO", roleCode: "cfo", slaHours: 96 },
      ],
    },
  ];
}

/** Amount used for policy selection when a document has no explicit total. */
export function zeroAmount(currency: string): Money {
  return money(0, currencyCode(currency));
}

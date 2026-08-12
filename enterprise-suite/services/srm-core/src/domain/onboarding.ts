import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import type { CertificationType } from "./certification.js";
import { boundedInt, nonEmpty, slug } from "./common.js";
import type { DateOnly } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";

/**
 * Supplier onboarding case: the checklist that turns a prospect into a
 * transactable supplier.
 *
 *   draft -> in_progress -> pending_approval -> approved
 *                                            \-> rejected
 *   draft/in_progress/pending_approval -> withdrawn
 *
 * A case is instantiated from a **template** (what a low-risk indirect
 * supplier must produce differs from a direct-material one) into concrete
 * steps and document requests. Three rules make it more than a to-do list:
 *
 *  - steps declare prerequisites, so evidence is gathered in an order that
 *    makes sense (no bank verification before the legal entity check);
 *  - the risk questionnaire scores answers into a risk tier, and the tier
 *    decides *which roles* must approve — a high-risk supplier cannot be
 *    waved through by procurement alone;
 *  - required steps can be waived, but only with a reason, and the waiver is
 *    part of the permanent record shown to the approvers.
 */

export type OnboardingStatus =
  | "draft"
  | "in_progress"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "withdrawn";

export const ONBOARDING_STATUSES: readonly OnboardingStatus[] = [
  "draft",
  "in_progress",
  "pending_approval",
  "approved",
  "rejected",
  "withdrawn",
];

export type OnboardingStepType =
  | "form"
  | "document"
  | "questionnaire"
  | "verification"
  | "site_visit"
  | "training"
  | "approval";

export const ONBOARDING_STEP_TYPES: readonly OnboardingStepType[] = [
  "form",
  "document",
  "questionnaire",
  "verification",
  "site_visit",
  "training",
  "approval",
];

export type OnboardingStepStatus = "pending" | "in_progress" | "completed" | "waived";

export type ApproverRole = "procurement" | "compliance" | "finance" | "quality" | "executive";

export const APPROVER_ROLES: readonly ApproverRole[] = [
  "procurement",
  "compliance",
  "finance",
  "quality",
  "executive",
];

export type OnboardingRiskTier = "low" | "medium" | "high" | "critical";

/** Which roles must sign off, by risk tier. Higher tiers add signatures. */
export const APPROVAL_MATRIX: Readonly<Record<OnboardingRiskTier, readonly ApproverRole[]>> = {
  low: ["procurement"],
  medium: ["procurement", "compliance"],
  high: ["procurement", "compliance", "finance"],
  critical: ["procurement", "compliance", "finance", "executive"],
};

export interface OnboardingStep {
  readonly code: string;
  readonly name: string;
  readonly type: OnboardingStepType;
  readonly required: boolean;
  readonly sequence: number;
  readonly ownerRole: ApproverRole;
  readonly prerequisites: readonly string[];
  /** Documents that must be verified before a `document` step can complete. */
  readonly documentCodes?: readonly string[];
  readonly status: OnboardingStepStatus;
  readonly dueOn?: DateOnly;
  readonly completedAt?: IsoDateTime;
  readonly completedBy?: UserId;
  readonly evidenceRef?: string;
  readonly waivedReason?: string;
}

export type DocumentStatus = "requested" | "received" | "verified" | "rejected";

export interface RequestedDocument {
  readonly code: string;
  readonly name: string;
  readonly required: boolean;
  readonly status: DocumentStatus;
  /** Set when the document maps onto a tracked certification type. */
  readonly certificationType?: CertificationType;
  readonly fileRef?: string;
  readonly receivedAt?: IsoDateTime;
  readonly verifiedAt?: IsoDateTime;
  readonly verifiedBy?: UserId;
  readonly expiresOn?: DateOnly;
  readonly rejectedReason?: string;
}

export interface QuestionnaireQuestion {
  readonly code: string;
  readonly prompt: string;
  /** Max points this question contributes to the risk score. */
  readonly weight: number;
  readonly required: boolean;
}

export interface QuestionnaireAnswer {
  readonly code: string;
  readonly value: string;
  /** 0..1 risk fraction assessed for the answer; scaled by the weight. */
  readonly riskFactor: number;
  readonly answeredAt: IsoDateTime;
  readonly note?: string;
}

export interface OnboardingApproval {
  readonly approverId: UserId;
  readonly role: ApproverRole;
  readonly decision: "approved" | "rejected";
  readonly comment?: string;
  readonly decidedAt: IsoDateTime;
}

export interface OnboardingTemplate {
  readonly code: string;
  readonly name: string;
  readonly steps: readonly Omit<OnboardingStep, "status" | "completedAt" | "completedBy" | "evidenceRef" | "waivedReason">[];
  readonly documents: readonly Omit<
    RequestedDocument,
    "status" | "fileRef" | "receivedAt" | "verifiedAt" | "verifiedBy" | "rejectedReason"
  >[];
  readonly questions: readonly QuestionnaireQuestion[];
  /** Floor applied to the computed tier: some templates are never "low". */
  readonly minimumRiskTier: OnboardingRiskTier;
}

const STANDARD_QUESTIONS: readonly QuestionnaireQuestion[] = [
  { code: "financial-stability", prompt: "Audited financials for the last two years?", weight: 20, required: true },
  { code: "subcontracting", prompt: "Share of work subcontracted?", weight: 10, required: true },
  { code: "single-source", prompt: "Are we single-sourced with this supplier?", weight: 15, required: true },
  { code: "data-access", prompt: "Will the supplier process personal or confidential data?", weight: 15, required: true },
  { code: "labour-practices", prompt: "Modern-slavery and labour-practice self-assessment", weight: 20, required: true },
  { code: "geo-exposure", prompt: "Operations in high-risk jurisdictions?", weight: 20, required: true },
];

export const ONBOARDING_TEMPLATES: Readonly<Record<string, OnboardingTemplate>> = {
  "indirect-low-risk": {
    code: "indirect-low-risk",
    name: "Indirect / low risk",
    minimumRiskTier: "low",
    steps: [
      { code: "legal-entity", name: "Legal entity verification", type: "verification", required: true, sequence: 10, ownerRole: "compliance", prerequisites: [] },
      { code: "tax-forms", name: "Tax forms collected", type: "document", required: true, sequence: 20, ownerRole: "finance", prerequisites: ["legal-entity"], documentCodes: ["tax-form"] },
      { code: "risk-questionnaire", name: "Risk questionnaire", type: "questionnaire", required: true, sequence: 30, ownerRole: "compliance", prerequisites: [] },
      { code: "bank-verification", name: "Bank account verification", type: "verification", required: true, sequence: 40, ownerRole: "finance", prerequisites: ["legal-entity", "tax-forms"] },
      { code: "code-of-conduct", name: "Supplier code of conduct signed", type: "document", required: true, sequence: 50, ownerRole: "compliance", prerequisites: [], documentCodes: ["coc"] },
    ],
    documents: [
      { code: "tax-form", name: "Tax registration / W-9", required: true, certificationType: "tax_form" },
      { code: "coc", name: "Signed code of conduct", required: true, certificationType: "code_of_conduct" },
      { code: "insurance", name: "Liability insurance certificate", required: false, certificationType: "insurance_liability" },
    ],
    questions: STANDARD_QUESTIONS,
  },
  "direct-material": {
    code: "direct-material",
    name: "Direct material / production",
    minimumRiskTier: "medium",
    steps: [
      { code: "legal-entity", name: "Legal entity verification", type: "verification", required: true, sequence: 10, ownerRole: "compliance", prerequisites: [] },
      { code: "tax-forms", name: "Tax forms collected", type: "document", required: true, sequence: 20, ownerRole: "finance", prerequisites: ["legal-entity"], documentCodes: ["tax-form"] },
      { code: "risk-questionnaire", name: "Risk questionnaire", type: "questionnaire", required: true, sequence: 30, ownerRole: "compliance", prerequisites: [] },
      { code: "quality-certificates", name: "Quality system certificates", type: "document", required: true, sequence: 40, ownerRole: "quality", prerequisites: ["legal-entity"], documentCodes: ["iso9001", "insurance"] },
      { code: "capability-assessment", name: "Capability & capacity assessment", type: "form", required: true, sequence: 50, ownerRole: "procurement", prerequisites: ["quality-certificates"] },
      { code: "site-audit", name: "On-site qualification audit", type: "site_visit", required: true, sequence: 60, ownerRole: "quality", prerequisites: ["capability-assessment"] },
      { code: "bank-verification", name: "Bank account verification", type: "verification", required: true, sequence: 70, ownerRole: "finance", prerequisites: ["legal-entity", "tax-forms"] },
      { code: "code-of-conduct", name: "Supplier code of conduct signed", type: "document", required: true, sequence: 80, ownerRole: "compliance", prerequisites: [], documentCodes: ["coc"] },
      { code: "esg-screening", name: "ESG / conflict-minerals screening", type: "questionnaire", required: false, sequence: 90, ownerRole: "compliance", prerequisites: ["risk-questionnaire"] },
    ],
    documents: [
      { code: "tax-form", name: "Tax registration / W-9", required: true, certificationType: "tax_form" },
      { code: "coc", name: "Signed code of conduct", required: true, certificationType: "code_of_conduct" },
      { code: "iso9001", name: "ISO 9001 certificate", required: true, certificationType: "iso9001" },
      { code: "insurance", name: "Liability insurance certificate", required: true, certificationType: "insurance_liability" },
      { code: "conflict-minerals", name: "Conflict minerals declaration", required: false, certificationType: "conflict_minerals" },
    ],
    questions: STANDARD_QUESTIONS,
  },
  "critical-service": {
    code: "critical-service",
    name: "Critical service / data processor",
    minimumRiskTier: "high",
    steps: [
      { code: "legal-entity", name: "Legal entity verification", type: "verification", required: true, sequence: 10, ownerRole: "compliance", prerequisites: [] },
      { code: "tax-forms", name: "Tax forms collected", type: "document", required: true, sequence: 20, ownerRole: "finance", prerequisites: ["legal-entity"], documentCodes: ["tax-form"] },
      { code: "risk-questionnaire", name: "Risk questionnaire", type: "questionnaire", required: true, sequence: 30, ownerRole: "compliance", prerequisites: [] },
      { code: "security-review", name: "Information security review", type: "form", required: true, sequence: 40, ownerRole: "compliance", prerequisites: ["risk-questionnaire"] },
      { code: "dpa", name: "Data processing agreement executed", type: "document", required: true, sequence: 50, ownerRole: "compliance", prerequisites: ["security-review"], documentCodes: ["dpa-doc", "soc2"] },
      { code: "bcp-review", name: "Business continuity plan review", type: "form", required: true, sequence: 60, ownerRole: "procurement", prerequisites: ["security-review"] },
      { code: "bank-verification", name: "Bank account verification", type: "verification", required: true, sequence: 70, ownerRole: "finance", prerequisites: ["legal-entity", "tax-forms"] },
      { code: "exec-briefing", name: "Executive risk briefing", type: "approval", required: true, sequence: 80, ownerRole: "executive", prerequisites: ["bcp-review", "dpa"] },
    ],
    documents: [
      { code: "tax-form", name: "Tax registration / W-9", required: true, certificationType: "tax_form" },
      { code: "coc", name: "Signed code of conduct", required: true, certificationType: "code_of_conduct" },
      { code: "soc2", name: "SOC 2 Type II report", required: true, certificationType: "soc2_type2" },
      { code: "dpa-doc", name: "Signed DPA", required: true, certificationType: "gdpr_dpa" },
      { code: "insurance", name: "Cyber liability insurance", required: true, certificationType: "insurance_liability" },
    ],
    questions: STANDARD_QUESTIONS,
  },
};

export const ONBOARDING_TEMPLATE_CODES: readonly string[] = Object.keys(ONBOARDING_TEMPLATES);

const TIER_ORDER: readonly OnboardingRiskTier[] = ["low", "medium", "high", "critical"];

export function riskTierFromScore(score: number): OnboardingRiskTier {
  if (score >= 70) return "critical";
  if (score >= 45) return "high";
  if (score >= 20) return "medium";
  return "low";
}

function atLeastTier(a: OnboardingRiskTier, b: OnboardingRiskTier): OnboardingRiskTier {
  return TIER_ORDER.indexOf(a) >= TIER_ORDER.indexOf(b) ? a : b;
}

export interface OnboardingCaseProps {
  number: string;
  supplierId: Ulid;
  supplierCode: string;
  templateCode: string;
  status: OnboardingStatus;
  steps: OnboardingStep[];
  documents: RequestedDocument[];
  questions: QuestionnaireQuestion[];
  answers: QuestionnaireAnswer[];
  approvals: OnboardingApproval[];
  minimumRiskTier: OnboardingRiskTier;
  targetGoLiveOn?: DateOnly;
  submittedAt?: IsoDateTime;
  submittedBy?: UserId;
  decidedAt?: IsoDateTime;
  rejectionReason?: string;
  withdrawnReason?: string;
}

export interface StartOnboardingInput {
  readonly number: string;
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly templateCode: string;
  readonly targetGoLiveOn?: DateOnly;
}

export class OnboardingCase extends AggregateRoot<OnboardingCaseProps> {
  static start(tenantId: TenantId, input: StartOnboardingInput): OnboardingCase {
    const template = ONBOARDING_TEMPLATES[input.templateCode];
    if (!template) {
      throw ValidationError.single(
        "templateCode",
        `unknown template "${input.templateCode}"; expected one of [${ONBOARDING_TEMPLATE_CODES.join(", ")}]`,
      );
    }
    const onboarding = new OnboardingCase(tenantId, {
      number: input.number,
      supplierId: input.supplierId,
      supplierCode: input.supplierCode,
      templateCode: template.code,
      status: "in_progress",
      steps: template.steps
        .map((step) => ({ ...step, status: "pending" as OnboardingStepStatus }))
        .sort((a, b) => a.sequence - b.sequence),
      documents: template.documents.map((doc) => ({ ...doc, status: "requested" as DocumentStatus })),
      questions: [...template.questions],
      answers: [],
      approvals: [],
      minimumRiskTier: template.minimumRiskTier,
      targetGoLiveOn: input.targetGoLiveOn,
    });
    onboarding.emit(SrmEventTypes.OnboardingStarted, { templateCode: template.code });
    return onboarding;
  }

  static fromSnapshot(snapshot: EntityProps & OnboardingCaseProps): OnboardingCase {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new OnboardingCase(
      tenantId,
      {
        ...props,
        steps: [...props.steps],
        documents: [...props.documents],
        questions: [...props.questions],
        answers: [...props.answers],
        approvals: [...props.approvals],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get number(): string {
    return this.props.number;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get supplierCode(): string {
    return this.props.supplierCode;
  }
  get status(): OnboardingStatus {
    return this.props.status;
  }
  get templateCode(): string {
    return this.props.templateCode;
  }
  get steps(): readonly OnboardingStep[] {
    return this.props.steps;
  }
  get documents(): readonly RequestedDocument[] {
    return this.props.documents;
  }
  get answers(): readonly QuestionnaireAnswer[] {
    return this.props.answers;
  }
  get approvals(): readonly OnboardingApproval[] {
    return this.props.approvals;
  }

  step(code: string): OnboardingStep | undefined {
    return this.props.steps.find((step) => step.code === code);
  }

  document(code: string): RequestedDocument | undefined {
    return this.props.documents.find((doc) => doc.code === code);
  }

  /** 0..100 weighted risk score from the questionnaire answers. */
  riskScore(): number {
    const totalWeight = this.props.questions.reduce((sum, question) => sum + question.weight, 0);
    if (totalWeight === 0) return 0;
    const scored = this.props.answers.reduce((sum, answer) => {
      const question = this.props.questions.find((q) => q.code === answer.code);
      return question ? sum + question.weight * answer.riskFactor : sum;
    }, 0);
    return Math.round((scored / totalWeight) * 100);
  }

  riskTier(): OnboardingRiskTier {
    return atLeastTier(riskTierFromScore(this.riskScore()), this.props.minimumRiskTier);
  }

  requiredApproverRoles(): readonly ApproverRole[] {
    return APPROVAL_MATRIX[this.riskTier()];
  }

  /** Completion of required work, as a 0..1 fraction for progress reporting. */
  completion(): number {
    const required = this.props.steps.filter((step) => step.required);
    if (required.length === 0) return 1;
    const done = required.filter((step) => step.status === "completed" || step.status === "waived").length;
    return done / required.length;
  }

  outstandingSteps(): readonly OnboardingStep[] {
    return this.props.steps.filter(
      (step) => step.required && step.status !== "completed" && step.status !== "waived",
    );
  }

  outstandingDocuments(): readonly RequestedDocument[] {
    return this.props.documents.filter((doc) => doc.required && doc.status !== "verified");
  }

  unansweredRequiredQuestions(): readonly QuestionnaireQuestion[] {
    return this.props.questions.filter(
      (question) => question.required && !this.props.answers.some((answer) => answer.code === question.code),
    );
  }

  // --- step workflow -------------------------------------------------------

  startStep(code: string): OnboardingStep {
    const index = this.requireStepIndex(code);
    const step = this.props.steps[index]!;
    this.assertOpen("start a step");
    if (step.status !== "pending") {
      throw new InvalidStateError(`Step ${code} is ${step.status}`);
    }
    this.assertPrerequisites(step);
    const updated = { ...step, status: "in_progress" as OnboardingStepStatus };
    this.props.steps[index] = updated;
    this.touch();
    return updated;
  }

  completeStep(code: string, by: UserId, at: IsoDateTime, evidenceRef?: string): OnboardingStep {
    const index = this.requireStepIndex(code);
    const step = this.props.steps[index]!;
    this.assertOpen("complete a step");
    if (step.status === "completed" || step.status === "waived") {
      throw new InvalidStateError(`Step ${code} is already ${step.status}`);
    }
    this.assertPrerequisites(step);
    // A document step is only done when its evidence is actually verified.
    if (step.type === "document") {
      const pending = this.pendingDocumentsFor(step);
      if (pending.length > 0) {
        throw new InvalidStateError(
          `Step ${code} needs verified documents: ${pending.map((doc) => doc.code).join(", ")}`,
        );
      }
    }
    if (step.type === "questionnaire" && this.unansweredRequiredQuestions().length > 0) {
      throw new InvalidStateError(
        `Step ${code} needs answers for: ${this.unansweredRequiredQuestions().map((q) => q.code).join(", ")}`,
      );
    }
    const updated: OnboardingStep = {
      ...step,
      status: "completed",
      completedAt: at,
      completedBy: by,
      evidenceRef: evidenceRef?.trim() || step.evidenceRef,
    };
    this.props.steps[index] = updated;
    this.emit(SrmEventTypes.OnboardingStepCompleted, {
      stepCode: updated.code,
      stepType: updated.type,
      actor: by,
    });
    return updated;
  }

  waiveStep(code: string, by: UserId, at: IsoDateTime, reason: string): OnboardingStep {
    const index = this.requireStepIndex(code);
    const step = this.props.steps[index]!;
    this.assertOpen("waive a step");
    if (step.status === "completed") {
      throw new InvalidStateError(`Step ${code} is already completed`);
    }
    const updated: OnboardingStep = {
      ...step,
      status: "waived",
      completedAt: at,
      completedBy: by,
      waivedReason: nonEmpty(reason, "reason", 500),
    };
    this.props.steps[index] = updated;
    this.emit(SrmEventTypes.OnboardingStepWaived, {
      stepCode: updated.code,
      stepType: updated.type,
      actor: by,
      reason: updated.waivedReason,
    });
    return updated;
  }

  // --- documents -----------------------------------------------------------

  requestDocument(input: {
    code: string;
    name: string;
    required?: boolean;
    certificationType?: CertificationType;
  }): RequestedDocument {
    this.assertOpen("request a document");
    const code = slug(input.code, "document.code");
    if (this.document(code)) {
      throw new InvalidStateError(`Document ${code} has already been requested`);
    }
    const doc: RequestedDocument = {
      code,
      name: nonEmpty(input.name, "document.name"),
      required: input.required ?? true,
      status: "requested",
      certificationType: input.certificationType,
    };
    this.props.documents.push(doc);
    this.touch();
    return doc;
  }

  receiveDocument(code: string, fileRef: string, at: IsoDateTime, expiresOn?: DateOnly): RequestedDocument {
    const index = this.requireDocumentIndex(code);
    const doc = this.props.documents[index]!;
    this.assertOpen("receive a document");
    if (doc.status === "verified") {
      throw new InvalidStateError(`Document ${code} is already verified`);
    }
    const updated: RequestedDocument = {
      ...doc,
      status: "received",
      fileRef: nonEmpty(fileRef, "fileRef", 300),
      receivedAt: at,
      expiresOn,
      rejectedReason: undefined,
    };
    this.props.documents[index] = updated;
    this.emit(SrmEventTypes.OnboardingDocumentReceived, {
      documentCode: code,
      status: updated.status,
      expiresOn,
    });
    return updated;
  }

  verifyDocument(code: string, by: UserId, at: IsoDateTime): RequestedDocument {
    const index = this.requireDocumentIndex(code);
    const doc = this.props.documents[index]!;
    this.assertOpen("verify a document");
    if (doc.status !== "received") {
      throw new InvalidStateError(`Document ${code} is ${doc.status}; only received documents can be verified`);
    }
    const updated: RequestedDocument = { ...doc, status: "verified", verifiedAt: at, verifiedBy: by };
    this.props.documents[index] = updated;
    this.emit(SrmEventTypes.OnboardingDocumentVerified, {
      documentCode: code,
      status: updated.status,
      expiresOn: updated.expiresOn,
    });
    return updated;
  }

  rejectDocument(code: string, reason: string, at: IsoDateTime): RequestedDocument {
    const index = this.requireDocumentIndex(code);
    const doc = this.props.documents[index]!;
    this.assertOpen("reject a document");
    if (doc.status === "requested") {
      throw new InvalidStateError(`Document ${code} has not been submitted yet`);
    }
    const updated: RequestedDocument = {
      ...doc,
      status: "rejected",
      rejectedReason: nonEmpty(reason, "reason", 500),
      verifiedAt: at,
    };
    this.props.documents[index] = updated;
    this.emit(SrmEventTypes.OnboardingDocumentRejected, {
      documentCode: code,
      status: updated.status,
      reason: updated.rejectedReason,
    });
    return updated;
  }

  // --- questionnaire -------------------------------------------------------

  answerQuestion(input: { code: string; value: string; riskFactor: number; note?: string }, at: IsoDateTime): void {
    this.assertOpen("answer the questionnaire");
    const question = this.props.questions.find((q) => q.code === input.code);
    if (!question) {
      throw ValidationError.single("code", `unknown question "${input.code}" for template ${this.props.templateCode}`);
    }
    if (!Number.isFinite(input.riskFactor) || input.riskFactor < 0 || input.riskFactor > 1) {
      throw ValidationError.single("riskFactor", "must be a fraction between 0 and 1");
    }
    const answer: QuestionnaireAnswer = {
      code: question.code,
      value: nonEmpty(input.value, "value", 500),
      riskFactor: input.riskFactor,
      answeredAt: at,
      note: input.note?.trim() || undefined,
    };
    const index = this.props.answers.findIndex((existing) => existing.code === question.code);
    if (index === -1) this.props.answers.push(answer);
    else this.props.answers[index] = answer;
    this.touch();
  }

  // --- decision ------------------------------------------------------------

  submitForApproval(by: UserId, at: IsoDateTime): void {
    if (this.props.status !== "in_progress") {
      throw new InvalidStateError(
        `Case ${this.props.number} is ${this.props.status}; only an in-progress case can be submitted`,
      );
    }
    const blockers: string[] = [];
    const openSteps = this.outstandingSteps();
    if (openSteps.length > 0) blockers.push(`steps: ${openSteps.map((s) => s.code).join(", ")}`);
    const openDocs = this.outstandingDocuments();
    if (openDocs.length > 0) blockers.push(`documents: ${openDocs.map((d) => d.code).join(", ")}`);
    const unanswered = this.unansweredRequiredQuestions();
    if (unanswered.length > 0) blockers.push(`questions: ${unanswered.map((q) => q.code).join(", ")}`);
    if (blockers.length > 0) {
      throw new InvalidStateError(`Case ${this.props.number} is incomplete — ${blockers.join("; ")}`, { blockers });
    }
    this.props.status = "pending_approval";
    this.props.submittedAt = at;
    this.props.submittedBy = by;
    this.emit(SrmEventTypes.OnboardingSubmitted, {
      riskScore: this.riskScore(),
      riskTier: this.riskTier(),
      requiredRoles: this.requiredApproverRoles(),
    });
  }

  /**
   * Records one role's decision. Every role in the risk-tier matrix must
   * approve; the first rejection ends the case. The submitter cannot approve
   * their own case, and a role votes once.
   */
  recordDecision(
    approverId: UserId,
    role: ApproverRole,
    decision: "approved" | "rejected",
    at: IsoDateTime,
    comment?: string,
  ): void {
    if (this.props.status !== "pending_approval") {
      throw new InvalidStateError(
        `Case ${this.props.number} is ${this.props.status}; only a submitted case can be decided`,
      );
    }
    if (!APPROVER_ROLES.includes(role)) {
      throw ValidationError.single("role", `must be one of [${APPROVER_ROLES.join(", ")}]`);
    }
    const required = this.requiredApproverRoles();
    if (!required.includes(role)) {
      throw new InvalidStateError(
        `Role ${role} is not part of the approval matrix for a ${this.riskTier()}-risk case (needs ${required.join(", ")})`,
      );
    }
    if (approverId === this.props.submittedBy) {
      throw new InvalidStateError("The submitter cannot approve their own onboarding case");
    }
    if (this.props.approvals.some((approval) => approval.role === role)) {
      throw new InvalidStateError(`Role ${role} has already decided on case ${this.props.number}`);
    }
    if (decision === "rejected" && !comment?.trim()) {
      throw ValidationError.single("comment", "a comment is required when rejecting");
    }
    this.props.approvals.push({ approverId, role, decision, comment: comment?.trim(), decidedAt: at });

    const approvedRoles = this.props.approvals.filter((a) => a.decision === "approved").map((a) => a.role);
    this.emit(SrmEventTypes.OnboardingApprovalRecorded, {
      decidedBy: approverId,
      decision,
      role,
      approvalsRecorded: approvedRoles.length,
      approvalsRequired: required.length,
      riskScore: this.riskScore(),
      comment: comment?.trim(),
    });

    if (decision === "rejected") {
      this.props.status = "rejected";
      this.props.decidedAt = at;
      this.props.rejectionReason = comment?.trim();
      this.emit(SrmEventTypes.OnboardingRejected, {
        decidedBy: approverId,
        decision,
        approvalsRecorded: approvedRoles.length,
        approvalsRequired: required.length,
        riskScore: this.riskScore(),
        comment: comment?.trim(),
      });
      return;
    }
    if (required.every((requiredRole) => approvedRoles.includes(requiredRole))) {
      this.props.status = "approved";
      this.props.decidedAt = at;
      this.emit(SrmEventTypes.OnboardingApproved, {
        decidedBy: approverId,
        decision,
        approvalsRecorded: approvedRoles.length,
        approvalsRequired: required.length,
        riskScore: this.riskScore(),
        riskTier: this.riskTier(),
      });
    }
  }

  withdraw(reason: string, at: IsoDateTime): void {
    if (this.props.status === "approved" || this.props.status === "rejected" || this.props.status === "withdrawn") {
      throw new InvalidStateError(`Case ${this.props.number} is ${this.props.status} and cannot be withdrawn`);
    }
    this.props.status = "withdrawn";
    this.props.withdrawnReason = nonEmpty(reason, "reason", 500);
    this.props.decidedAt = at;
    this.emit(SrmEventTypes.OnboardingWithdrawn, { reason: this.props.withdrawnReason });
  }

  /** Extends the target go-live, e.g. when a site audit slips. */
  reschedule(targetGoLiveOn: DateOnly): void {
    this.assertOpen("reschedule");
    this.props.targetGoLiveOn = targetGoLiveOn;
    this.touch();
  }

  /** Adds an ad-hoc step, e.g. a regulator asks for one more check. */
  addStep(input: {
    code: string;
    name: string;
    type: OnboardingStepType;
    ownerRole: ApproverRole;
    required?: boolean;
    prerequisites?: readonly string[];
    dueOn?: DateOnly;
  }): OnboardingStep {
    this.assertOpen("add a step");
    const code = slug(input.code, "step.code");
    if (this.step(code)) throw new InvalidStateError(`Step ${code} already exists on case ${this.props.number}`);
    if (!ONBOARDING_STEP_TYPES.includes(input.type)) {
      throw ValidationError.single("step.type", `must be one of [${ONBOARDING_STEP_TYPES.join(", ")}]`);
    }
    for (const prerequisite of input.prerequisites ?? []) {
      if (!this.step(prerequisite)) {
        throw ValidationError.single("prerequisites", `unknown step "${prerequisite}"`);
      }
    }
    const sequence = boundedInt(
      (this.props.steps.at(-1)?.sequence ?? 0) + 10,
      "step.sequence",
      1,
      100_000,
    );
    const step: OnboardingStep = {
      code,
      name: nonEmpty(input.name, "step.name"),
      type: input.type,
      required: input.required ?? true,
      sequence,
      ownerRole: input.ownerRole,
      prerequisites: [...(input.prerequisites ?? [])],
      status: "pending",
      dueOn: input.dueOn,
    };
    this.props.steps.push(step);
    this.touch();
    return step;
  }

  // --- helpers -------------------------------------------------------------

  /**
   * A document step gates on the documents it declares; when it declares
   * none it falls back to a document sharing its code, and failing that to
   * every required document of the case.
   */
  private pendingDocumentsFor(step: OnboardingStep): readonly RequestedDocument[] {
    const declared = step.documentCodes ?? [];
    if (declared.length > 0) {
      return this.props.documents.filter((doc) => declared.includes(doc.code) && doc.status !== "verified");
    }
    const linked = this.document(step.code);
    if (linked) return linked.status === "verified" ? [] : [linked];
    return this.props.documents.filter((doc) => doc.required && doc.status !== "verified");
  }

  private assertPrerequisites(step: OnboardingStep): void {
    const blocked = step.prerequisites.filter((code) => {
      const prerequisite = this.step(code);
      return !prerequisite || (prerequisite.status !== "completed" && prerequisite.status !== "waived");
    });
    if (blocked.length > 0) {
      throw new InvalidStateError(`Step ${step.code} is blocked by ${blocked.join(", ")}`, { blocked });
    }
  }

  private assertOpen(action: string): void {
    if (this.props.status !== "in_progress" && this.props.status !== "draft") {
      throw new InvalidStateError(`Cannot ${action}: case ${this.props.number} is ${this.props.status}`);
    }
  }

  private requireStepIndex(code: string): number {
    const index = this.props.steps.findIndex((step) => step.code === code);
    if (index === -1) throw new InvalidStateError(`Step ${code} is not part of case ${this.props.number}`);
    return index;
  }

  private requireDocumentIndex(code: string): number {
    const index = this.props.documents.findIndex((doc) => doc.code === code);
    if (index === -1) throw new InvalidStateError(`Document ${code} is not part of case ${this.props.number}`);
    return index;
  }

  private emit(eventType: string, extra: Record<string, unknown> = {}): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "OnboardingCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          caseId: this.id,
          caseNumber: this.props.number,
          supplierId: this.props.supplierId,
          supplierCode: this.props.supplierCode,
          status: this.props.status,
          ...extra,
        },
      }),
    );
  }
}

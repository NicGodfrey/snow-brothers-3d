/**
 * Audit checklists and audit execution.
 *
 * Two aggregates:
 *
 * 1. AuditChecklistTemplate — a reusable checklist (e.g. "ISO 9001:2015
 *    internal audit", "Supplier process audit") organised into sections
 *    of items. Each item declares how it is answered:
 *      - "conformity": conform / minor-nc / major-nc / not-applicable
 *      - "score":      0..5
 *      - "yes-no":     yes / no / not-applicable
 *
 * 2. Audit — one execution of a template against an auditee (site,
 *    department or supplier). The audit snapshots the template items,
 *    collects responses, findings (observations, OFIs, minor/major
 *    non-conformities) and computes a weighted score on completion.
 *
 * Workflow: planned -> in-progress -> review -> completed -> closed
 *           (planned | in-progress) -> cancelled
 *
 * Closing rule: every major-nc finding must be linked to an NCR or CAPA
 * before the audit can be closed — this is what forces audit findings
 * into the corrective-action loop.
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  newId,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { QualityEventTypes, type AuditCompletedPayload } from "./events.js";
import { StateMachine } from "./state-machine.js";

// ---------------------------------------------------------------------------
// Checklist template
// ---------------------------------------------------------------------------

export type AnswerType = "conformity" | "score" | "yes-no";
export type TemplateStatus = "draft" | "active" | "retired";

export interface ChecklistItem {
  readonly id: Ulid;
  readonly question: string;
  readonly answerType: AnswerType;
  readonly guidance?: string;
  /** e.g. "ISO9001:2015 §8.5.1" */
  readonly requirementRef?: string;
  /** Relative weight in the score computation (default 1). */
  readonly weight: number;
}

export interface ChecklistSection {
  readonly id: Ulid;
  readonly title: string;
  readonly items: ChecklistItem[];
}

interface TemplateProps {
  code: string;
  title: string;
  standard?: string;
  status: TemplateStatus;
  sections: ChecklistSection[];
}

export class AuditChecklistTemplate extends AggregateRoot<TemplateProps> {
  private constructor(tenantId: TenantId, props: TemplateProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(
    tenantId: TenantId,
    input: { code: string; title: string; standard?: string },
  ): AuditChecklistTemplate {
    if (!input.code.trim()) throw new DomainError("code is required", "VALIDATION");
    if (!input.title.trim()) throw new DomainError("title is required", "VALIDATION");
    return new AuditChecklistTemplate(tenantId, {
      code: input.code.trim().toUpperCase(),
      title: input.title.trim(),
      standard: input.standard,
      status: "draft",
      sections: [],
    });
  }

  static rehydrate(tenantId: TenantId, props: TemplateProps, existing: Partial<EntityProps>): AuditChecklistTemplate {
    return new AuditChecklistTemplate(tenantId, props, existing);
  }

  get code(): string { return this.props.code; }
  get status(): TemplateStatus { return this.props.status; }
  get sections(): readonly ChecklistSection[] { return this.props.sections; }
  get standard(): string | undefined { return this.props.standard; }

  private assertDraft(): void {
    if (this.props.status !== "draft") {
      throw new ConflictError(`Template ${this.props.code} is '${this.props.status}'; only drafts are editable`);
    }
  }

  addSection(title: string): ChecklistSection {
    this.assertDraft();
    if (!title.trim()) throw new DomainError("section title is required", "VALIDATION");
    const section: ChecklistSection = { id: newId("csec"), title: title.trim(), items: [] };
    this.props.sections.push(section);
    this.touch();
    return section;
  }

  addItem(
    sectionId: Ulid,
    input: {
      question: string;
      answerType: AnswerType;
      guidance?: string;
      requirementRef?: string;
      weight?: number;
    },
  ): ChecklistItem {
    this.assertDraft();
    const section = this.props.sections.find((s) => s.id === sectionId);
    if (!section) throw new DomainError(`Section ${sectionId} not found`, "NOT_FOUND", 404);
    if (!input.question.trim()) throw new DomainError("question is required", "VALIDATION");
    const weight = input.weight ?? 1;
    if (weight <= 0) throw new DomainError("weight must be positive", "VALIDATION");
    const item: ChecklistItem = {
      id: newId("citem"),
      question: input.question.trim(),
      answerType: input.answerType,
      guidance: input.guidance,
      requirementRef: input.requirementRef,
      weight,
    };
    section.items.push(item);
    this.touch();
    return item;
  }

  activate(): void {
    this.assertDraft();
    const itemCount = this.props.sections.reduce((n, s) => n + s.items.length, 0);
    if (itemCount === 0) throw new ConflictError("Cannot activate a template without items");
    this.props.status = "active";
    this.raise(
      envelope({
        eventType: QualityEventTypes.AuditTemplateActivated,
        aggregateType: "AuditChecklistTemplate",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, itemCount },
      }),
    );
  }

  retire(): void {
    if (this.props.status !== "active") {
      throw new ConflictError(`Only active templates can be retired (status: ${this.props.status})`);
    }
    this.props.status = "retired";
    this.touch();
  }
}

// ---------------------------------------------------------------------------
// Audit execution
// ---------------------------------------------------------------------------

export type AuditType = "internal" | "supplier" | "process" | "certification";
export type AuditStatus = "planned" | "in-progress" | "review" | "completed" | "closed" | "cancelled";

export type ConformityAnswer = "conform" | "minor-nc" | "major-nc" | "not-applicable";
export type YesNoAnswer = "yes" | "no" | "not-applicable";

export type ItemAnswer =
  | { readonly kind: "conformity"; readonly value: ConformityAnswer }
  | { readonly kind: "score"; readonly value: number }
  | { readonly kind: "yes-no"; readonly value: YesNoAnswer };

export interface ItemResponse {
  readonly itemId: Ulid;
  readonly answer: ItemAnswer;
  readonly evidence?: string;
  readonly comment?: string;
  readonly answeredBy: UserId;
  readonly answeredAt: IsoDateTime;
}

export type FindingClassification = "observation" | "ofi" | "minor-nc" | "major-nc";

export interface AuditFinding {
  readonly id: Ulid;
  readonly classification: FindingClassification;
  readonly description: string;
  readonly itemId?: Ulid;
  readonly requirementRef?: string;
  readonly ncrId?: Ulid;
  readonly capaId?: Ulid;
  readonly recordedBy: UserId;
  readonly recordedAt: IsoDateTime;
}

export interface Auditee {
  readonly site?: string;
  readonly department?: string;
  readonly supplierId?: string;
}

export interface AuditResult {
  readonly scorePercent: number;
  readonly achievedPoints: number;
  readonly maxPoints: number;
  readonly outcome: "pass" | "conditional" | "fail";
  readonly summary?: string;
}

interface AuditProps {
  auditNumber: string;
  auditType: AuditType;
  templateId: Ulid;
  templateCode: string;
  scope: string;
  auditee: Auditee;
  leadAuditor: UserId;
  auditors: UserId[];
  plannedFrom: IsoDateTime;
  plannedTo: IsoDateTime;
  status: AuditStatus;
  /** Snapshot of template sections at planning time. */
  sections: ChecklistSection[];
  responses: ItemResponse[];
  findings: AuditFinding[];
  result?: AuditResult;
  cancellationReason?: string;
}

const PASS_THRESHOLD = 85;
const CONDITIONAL_THRESHOLD = 70;

const auditMachine = new StateMachine<AuditStatus, Audit>(
  "Audit",
  [
    { from: "planned", to: "in-progress" },
    {
      from: "in-progress",
      to: "review",
      guard: (audit) => {
        const missing = audit.unansweredItemCount();
        return missing > 0 ? `${missing} checklist item(s) unanswered` : undefined;
      },
    },
    { from: "review", to: "completed" },
    {
      from: "completed",
      to: "closed",
      guard: (audit) => {
        const unlinked = audit.findings.filter(
          (f) => f.classification === "major-nc" && !f.ncrId && !f.capaId,
        );
        return unlinked.length > 0
          ? `${unlinked.length} major non-conformit(ies) not yet linked to an NCR or CAPA`
          : undefined;
      },
    },
    { from: ["planned", "in-progress"], to: "cancelled" },
  ],
  ["closed", "cancelled"],
);

export class Audit extends AggregateRoot<AuditProps> {
  private constructor(tenantId: TenantId, props: AuditProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static plan(
    tenantId: TenantId,
    input: {
      auditNumber: string;
      auditType: AuditType;
      template: AuditChecklistTemplate;
      scope: string;
      auditee: Auditee;
      leadAuditor: UserId;
      auditors?: UserId[];
      plannedFrom: IsoDateTime;
      plannedTo: IsoDateTime;
    },
  ): Audit {
    if (input.template.status !== "active") {
      throw new ConflictError(`Template ${input.template.code} is not active`);
    }
    if (!input.scope.trim()) throw new DomainError("scope is required", "VALIDATION");
    if (input.plannedTo < input.plannedFrom) {
      throw new DomainError("plannedTo must be >= plannedFrom", "VALIDATION");
    }
    if (input.auditType === "supplier" && !input.auditee.supplierId) {
      throw new DomainError("supplier audits require auditee.supplierId", "VALIDATION");
    }
    const audit = new Audit(tenantId, {
      auditNumber: input.auditNumber,
      auditType: input.auditType,
      templateId: input.template.id,
      templateCode: input.template.code,
      scope: input.scope.trim(),
      auditee: input.auditee,
      leadAuditor: input.leadAuditor,
      auditors: input.auditors ?? [],
      plannedFrom: input.plannedFrom,
      plannedTo: input.plannedTo,
      status: "planned",
      sections: input.template.sections.map((s) => ({
        id: s.id,
        title: s.title,
        items: s.items.map((i) => ({ ...i })),
      })),
      responses: [],
      findings: [],
    });
    audit.raise(
      envelope({
        eventType: QualityEventTypes.AuditPlanned,
        aggregateType: "Audit",
        aggregateId: audit.id,
        tenantId,
        payload: {
          auditNumber: input.auditNumber,
          auditType: input.auditType,
          templateCode: input.template.code,
          supplierId: input.auditee.supplierId,
        },
      }),
    );
    return audit;
  }

  static rehydrate(tenantId: TenantId, props: AuditProps, existing: Partial<EntityProps>): Audit {
    return new Audit(tenantId, props, existing);
  }

  get auditNumber(): string { return this.props.auditNumber; }
  get auditType(): AuditType { return this.props.auditType; }
  get status(): AuditStatus { return this.props.status; }
  get auditee(): Auditee { return this.props.auditee; }
  get sections(): readonly ChecklistSection[] { return this.props.sections; }
  get responses(): readonly ItemResponse[] { return this.props.responses; }
  get findings(): readonly AuditFinding[] { return this.props.findings; }
  get result(): AuditResult | undefined { return this.props.result; }
  get templateId(): Ulid { return this.props.templateId; }

  private allItems(): ChecklistItem[] {
    return this.props.sections.flatMap((s) => s.items);
  }

  unansweredItemCount(): number {
    const answered = new Set(this.props.responses.map((r) => r.itemId));
    return this.allItems().filter((i) => !answered.has(i.id)).length;
  }

  start(): void {
    this.props.status = auditMachine.assertTransition(this.props.status, "in-progress", this);
    this.raise(
      envelope({
        eventType: QualityEventTypes.AuditStarted,
        aggregateType: "Audit",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { auditNumber: this.props.auditNumber },
      }),
    );
  }

  answerItem(
    itemId: Ulid,
    answer: ItemAnswer,
    answeredBy: UserId,
    details?: { evidence?: string; comment?: string },
  ): ItemResponse {
    if (this.props.status !== "in-progress") {
      throw new ConflictError(`Items can only be answered in-progress (status: ${this.props.status})`);
    }
    const item = this.allItems().find((i) => i.id === itemId);
    if (!item) throw new DomainError(`Checklist item ${itemId} not on audit`, "NOT_FOUND", 404);
    if (item.answerType !== answer.kind) {
      throw new DomainError(
        `Item expects answer type '${item.answerType}', got '${answer.kind}'`,
        "VALIDATION",
      );
    }
    if (answer.kind === "score" && (!Number.isInteger(answer.value) || answer.value < 0 || answer.value > 5)) {
      throw new DomainError("score answers must be integers 0..5", "VALIDATION");
    }
    const existingIdx = this.props.responses.findIndex((r) => r.itemId === itemId);
    const response: ItemResponse = {
      itemId,
      answer,
      evidence: details?.evidence,
      comment: details?.comment,
      answeredBy,
      answeredAt: nowIso(),
    };
    // Re-answering while in-progress overwrites (auditors refine notes).
    if (existingIdx >= 0) this.props.responses[existingIdx] = response;
    else this.props.responses.push(response);
    this.touch();
    return response;
  }

  recordFinding(input: {
    classification: FindingClassification;
    description: string;
    itemId?: Ulid;
    requirementRef?: string;
    recordedBy: UserId;
  }): AuditFinding {
    if (this.props.status !== "in-progress" && this.props.status !== "review") {
      throw new ConflictError(
        `Findings can only be recorded in-progress or review (status: ${this.props.status})`,
      );
    }
    if (!input.description.trim()) throw new DomainError("finding description is required", "VALIDATION");
    if (input.itemId && !this.allItems().some((i) => i.id === input.itemId)) {
      throw new DomainError(`Checklist item ${input.itemId} not on audit`, "NOT_FOUND", 404);
    }
    const finding: AuditFinding = {
      id: newId("find"),
      classification: input.classification,
      description: input.description.trim(),
      itemId: input.itemId,
      requirementRef: input.requirementRef,
      recordedBy: input.recordedBy,
      recordedAt: nowIso(),
    };
    this.props.findings.push(finding);
    this.raise(
      envelope({
        eventType: QualityEventTypes.AuditFindingRecorded,
        aggregateType: "Audit",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          auditNumber: this.props.auditNumber,
          findingId: finding.id,
          classification: input.classification,
          supplierId: this.props.auditee.supplierId,
        },
      }),
    );
    return finding;
  }

  linkFinding(findingId: Ulid, link: { ncrId?: Ulid; capaId?: Ulid }): AuditFinding {
    if (!link.ncrId && !link.capaId) {
      throw new DomainError("Provide ncrId and/or capaId to link a finding", "VALIDATION");
    }
    const idx = this.props.findings.findIndex((f) => f.id === findingId);
    if (idx === -1) throw new DomainError(`Finding ${findingId} not found`, "NOT_FOUND", 404);
    const finding = this.props.findings[idx]!;
    const updated: AuditFinding = {
      ...finding,
      ncrId: link.ncrId ?? finding.ncrId,
      capaId: link.capaId ?? finding.capaId,
    };
    this.props.findings[idx] = updated;
    this.touch();
    return updated;
  }

  moveToReview(): void {
    this.props.status = auditMachine.assertTransition(this.props.status, "review", this);
  }

  /**
   * Scoring: each answered item contributes weight * factor where factor is
   *   conformity: conform=1, minor-nc=0.5, major-nc=0
   *   score:      value / 5
   *   yes-no:     yes=1, no=0
   * "not-applicable" answers are excluded from both numerator and
   * denominator. Outcome: >=85% pass, >=70% conditional, otherwise fail.
   */
  complete(summary?: string): AuditResult {
    auditMachine.assertTransition(this.props.status, "completed", this);
    let achieved = 0;
    let max = 0;
    const itemsById = new Map(this.allItems().map((i) => [i.id, i]));
    for (const response of this.props.responses) {
      const item = itemsById.get(response.itemId);
      if (!item) continue;
      const factor = answerFactor(response.answer);
      if (factor === null) continue; // not-applicable
      achieved += item.weight * factor;
      max += item.weight;
    }
    const scorePercent = max === 0 ? 0 : Math.round((achieved / max) * 1000) / 10;
    // Any major non-conformity caps the outcome at "conditional".
    const hasMajorNc = this.props.findings.some((f) => f.classification === "major-nc");
    let outcome: AuditResult["outcome"];
    if (scorePercent >= PASS_THRESHOLD && !hasMajorNc) outcome = "pass";
    else if (scorePercent >= CONDITIONAL_THRESHOLD) outcome = "conditional";
    else outcome = "fail";

    const result: AuditResult = {
      scorePercent,
      achievedPoints: Math.round(achieved * 100) / 100,
      maxPoints: max,
      outcome,
      summary,
    };
    this.props.result = result;
    this.props.status = "completed";

    const counts = { observation: 0, ofi: 0, minorNc: 0, majorNc: 0 };
    for (const f of this.props.findings) {
      if (f.classification === "observation") counts.observation += 1;
      else if (f.classification === "ofi") counts.ofi += 1;
      else if (f.classification === "minor-nc") counts.minorNc += 1;
      else counts.majorNc += 1;
    }
    const payload: AuditCompletedPayload = {
      auditNumber: this.props.auditNumber,
      auditType: this.props.auditType,
      scorePercent,
      outcome,
      findingCounts: counts,
      supplierId: this.props.auditee.supplierId,
    };
    this.raise(
      envelope({
        eventType: QualityEventTypes.AuditCompleted,
        aggregateType: "Audit",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
    this.touch();
    return result;
  }

  close(): void {
    this.props.status = auditMachine.assertTransition(this.props.status, "closed", this);
    this.raise(
      envelope({
        eventType: QualityEventTypes.AuditClosed,
        aggregateType: "Audit",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { auditNumber: this.props.auditNumber, outcome: this.props.result?.outcome },
      }),
    );
  }

  cancel(reason: string): void {
    if (!reason.trim()) throw new DomainError("Cancellation reason is required", "VALIDATION");
    this.props.status = auditMachine.assertTransition(this.props.status, "cancelled", this);
    this.props.cancellationReason = reason.trim();
    this.touch();
  }
}

function answerFactor(answer: ItemAnswer): number | null {
  switch (answer.kind) {
    case "conformity":
      switch (answer.value) {
        case "conform": return 1;
        case "minor-nc": return 0.5;
        case "major-nc": return 0;
        case "not-applicable": return null;
      }
      break;
    case "score":
      return answer.value / 5;
    case "yes-no":
      switch (answer.value) {
        case "yes": return 1;
        case "no": return 0;
        case "not-applicable": return null;
      }
  }
}

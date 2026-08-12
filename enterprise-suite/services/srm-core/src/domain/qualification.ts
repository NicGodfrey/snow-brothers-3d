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
import { nonEmpty } from "./common.js";
import { addMonths, compareDates, type DateOnly } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";

/**
 * Supplier qualification: the audit that decides whether a supplier is
 * technically fit to serve a category.
 *
 *   planned -> in_progress -> completed(passed | conditional | failed)
 *                          \-> withdrawn          \-> expired
 *
 * The outcome is *derived*, never typed in by hand: it falls out of the
 * weighted section scores plus the severity of the open findings. A critical
 * finding fails the audit no matter how good the numbers are, an open major
 * finding caps the result at "conditional", and a conditional pass gets half
 * the normal validity so the supplier comes back sooner. Corrective actions
 * (CAPA) hang off the findings and can be closed after the audit — closing
 * the last major finding is what lets QualificationService re-rate a
 * conditional supplier.
 */

export type QualificationType = "initial" | "requalification" | "for_cause" | "surveillance";

export const QUALIFICATION_TYPES: readonly QualificationType[] = [
  "initial",
  "requalification",
  "for_cause",
  "surveillance",
];

export type QualificationMethod = "desk_review" | "self_assessment" | "virtual_audit" | "onsite_audit";

export const QUALIFICATION_METHODS: readonly QualificationMethod[] = [
  "desk_review",
  "self_assessment",
  "virtual_audit",
  "onsite_audit",
];

export type QualificationStatus = "planned" | "in_progress" | "completed" | "expired" | "withdrawn";

export type QualificationOutcome = "pending" | "passed" | "conditional" | "failed";

export type FindingSeverity = "observation" | "minor" | "major" | "critical";

export const FINDING_SEVERITIES: readonly FindingSeverity[] = ["observation", "minor", "major", "critical"];

/** Assessment sections; weights are per-qualification, these are the defaults. */
export type SectionCode =
  | "quality_system"
  | "manufacturing_capability"
  | "delivery_performance"
  | "financial_health"
  | "esg_compliance"
  | "information_security"
  | "capacity_scalability";

export const SECTION_CODES: readonly SectionCode[] = [
  "quality_system",
  "manufacturing_capability",
  "delivery_performance",
  "financial_health",
  "esg_compliance",
  "information_security",
  "capacity_scalability",
];

export const DEFAULT_SECTION_WEIGHTS: Readonly<Record<SectionCode, number>> = {
  quality_system: 30,
  manufacturing_capability: 20,
  delivery_performance: 15,
  financial_health: 15,
  esg_compliance: 10,
  information_security: 5,
  capacity_scalability: 5,
};

/** Score thresholds for the derived outcome. */
export const PASS_SCORE = 75;
export const CONDITIONAL_SCORE = 60;

export interface QualificationSection {
  readonly code: SectionCode;
  readonly weight: number;
  readonly score?: number;
  readonly notes?: string;
  readonly scoredAt?: IsoDateTime;
}

export interface CorrectiveAction {
  readonly action: string;
  readonly ownerId: UserId;
  readonly dueOn: DateOnly;
  readonly closedAt?: IsoDateTime;
  readonly evidence?: string;
}

export interface QualificationFinding {
  readonly id: Ulid;
  readonly section: SectionCode;
  readonly severity: FindingSeverity;
  readonly description: string;
  readonly raisedAt: IsoDateTime;
  readonly status: "open" | "closed" | "waived";
  readonly capa?: CorrectiveAction;
  readonly closedAt?: IsoDateTime;
  readonly closedBy?: UserId;
  readonly waivedReason?: string;
}

export interface QualificationProps {
  reference: string;
  supplierId: Ulid;
  supplierCode: string;
  categoryId?: Ulid;
  siteId?: Ulid;
  type: QualificationType;
  method: QualificationMethod;
  status: QualificationStatus;
  outcome: QualificationOutcome;
  scheduledOn: DateOnly;
  startedAt?: IsoDateTime;
  conductedOn?: DateOnly;
  auditorId?: UserId;
  sections: QualificationSection[];
  findings: QualificationFinding[];
  score?: number;
  validUntil?: DateOnly;
  /** Standard validity in months; halved for a conditional outcome. */
  validityMonths: number;
  conditions: string[];
  summary?: string;
  withdrawnReason?: string;
}

export interface ScheduleQualificationInput {
  readonly reference: string;
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly type: QualificationType;
  readonly method: QualificationMethod;
  readonly scheduledOn: DateOnly;
  readonly categoryId?: Ulid;
  readonly siteId?: Ulid;
  readonly validityMonths?: number;
  readonly sectionWeights?: Partial<Record<SectionCode, number>>;
}

function buildSections(weights?: Partial<Record<SectionCode, number>>): QualificationSection[] {
  const merged = { ...DEFAULT_SECTION_WEIGHTS, ...(weights ?? {}) };
  const sections = SECTION_CODES.map((code) => ({ code, weight: merged[code] }))
    // A zero weight means "not applicable to this audit" — drop the section
    // rather than carry a scoreless row that would block completion.
    .filter((section) => section.weight > 0);
  if (sections.length === 0) {
    throw ValidationError.single("sectionWeights", "at least one section must carry weight");
  }
  for (const section of sections) {
    if (!Number.isFinite(section.weight) || section.weight < 0 || section.weight > 100) {
      throw ValidationError.single(`sectionWeights.${section.code}`, "must be between 0 and 100");
    }
  }
  return sections;
}

export class Qualification extends AggregateRoot<QualificationProps> {
  static schedule(tenantId: TenantId, input: ScheduleQualificationInput): Qualification {
    if (!QUALIFICATION_TYPES.includes(input.type)) {
      throw ValidationError.single("type", `must be one of [${QUALIFICATION_TYPES.join(", ")}]`);
    }
    if (!QUALIFICATION_METHODS.includes(input.method)) {
      throw ValidationError.single("method", `must be one of [${QUALIFICATION_METHODS.join(", ")}]`);
    }
    const validityMonths = input.validityMonths ?? 24;
    if (!Number.isInteger(validityMonths) || validityMonths < 3 || validityMonths > 60) {
      throw ValidationError.single("validityMonths", "must be an integer between 3 and 60");
    }
    const qualification = new Qualification(tenantId, {
      reference: input.reference,
      supplierId: input.supplierId,
      supplierCode: input.supplierCode,
      categoryId: input.categoryId,
      siteId: input.siteId,
      type: input.type,
      method: input.method,
      status: "planned",
      outcome: "pending",
      scheduledOn: input.scheduledOn,
      sections: buildSections(input.sectionWeights),
      findings: [],
      validityMonths,
      conditions: [],
    });
    qualification.emit(SrmEventTypes.QualificationScheduled);
    return qualification;
  }

  static fromSnapshot(snapshot: EntityProps & QualificationProps): Qualification {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Qualification(
      tenantId,
      {
        ...props,
        sections: [...props.sections],
        findings: [...props.findings],
        conditions: [...props.conditions],
      },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get reference(): string {
    return this.props.reference;
  }
  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get supplierCode(): string {
    return this.props.supplierCode;
  }
  get categoryId(): Ulid | undefined {
    return this.props.categoryId;
  }
  get status(): QualificationStatus {
    return this.props.status;
  }
  get outcome(): QualificationOutcome {
    return this.props.outcome;
  }
  get type(): QualificationType {
    return this.props.type;
  }
  get method(): QualificationMethod {
    return this.props.method;
  }
  get sections(): readonly QualificationSection[] {
    return this.props.sections;
  }
  get findings(): readonly QualificationFinding[] {
    return this.props.findings;
  }
  get score(): number | undefined {
    return this.props.score;
  }
  get validUntil(): DateOnly | undefined {
    return this.props.validUntil;
  }
  get conditions(): readonly string[] {
    return this.props.conditions;
  }
  get scheduledOn(): DateOnly {
    return this.props.scheduledOn;
  }
  get conductedOn(): DateOnly | undefined {
    return this.props.conductedOn;
  }

  openFindings(minimumSeverity: FindingSeverity = "observation"): readonly QualificationFinding[] {
    const floor = FINDING_SEVERITIES.indexOf(minimumSeverity);
    return this.props.findings.filter(
      (finding) => finding.status === "open" && FINDING_SEVERITIES.indexOf(finding.severity) >= floor,
    );
  }

  overdueCapas(asOf: DateOnly): readonly QualificationFinding[] {
    return this.props.findings.filter(
      (finding) => finding.status === "open" && finding.capa && compareDates(finding.capa.dueOn, asOf) < 0,
    );
  }

  /** Weighted 0..100 score over the sections scored so far. */
  weightedScore(): number {
    const scored = this.props.sections.filter((section) => section.score !== undefined);
    const totalWeight = scored.reduce((sum, section) => sum + section.weight, 0);
    if (totalWeight === 0) return 0;
    const weighted = scored.reduce((sum, section) => sum + section.weight * (section.score ?? 0), 0);
    return Math.round((weighted / totalWeight) * 10) / 10;
  }

  /** Valid for award decisions on the given day. */
  isValidOn(asOf: DateOnly): boolean {
    if (this.props.status !== "completed") return false;
    if (this.props.outcome !== "passed" && this.props.outcome !== "conditional") return false;
    return this.props.validUntil !== undefined && compareDates(asOf, this.props.validUntil) <= 0;
  }

  // --- workflow ------------------------------------------------------------

  start(auditorId: UserId, at: IsoDateTime): void {
    if (this.props.status !== "planned") {
      throw new InvalidStateError(`Qualification ${this.props.reference} is ${this.props.status}`);
    }
    this.props.status = "in_progress";
    this.props.startedAt = at;
    this.props.auditorId = auditorId;
    this.emit(SrmEventTypes.QualificationStarted);
  }

  scoreSection(code: SectionCode, score: number, at: IsoDateTime, notes?: string): QualificationSection {
    this.assertInProgress("score a section");
    const index = this.props.sections.findIndex((section) => section.code === code);
    if (index === -1) {
      throw new InvalidStateError(`Section ${code} is not part of qualification ${this.props.reference}`);
    }
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      throw ValidationError.single("score", "must be between 0 and 100");
    }
    const updated: QualificationSection = {
      ...this.props.sections[index]!,
      score: Math.round(score * 10) / 10,
      notes: notes?.trim() || undefined,
      scoredAt: at,
    };
    this.props.sections[index] = updated;
    this.emit(SrmEventTypes.QualificationSectionScored, { section: code, score: updated.score });
    return updated;
  }

  raiseFinding(
    input: {
      section: SectionCode;
      severity: FindingSeverity;
      description: string;
      capa?: { action: string; ownerId: UserId; dueOn: DateOnly };
    },
    at: IsoDateTime,
  ): QualificationFinding {
    this.assertInProgress("raise a finding");
    if (!FINDING_SEVERITIES.includes(input.severity)) {
      throw ValidationError.single("severity", `must be one of [${FINDING_SEVERITIES.join(", ")}]`);
    }
    if (!this.props.sections.some((section) => section.code === input.section)) {
      throw new InvalidStateError(`Section ${input.section} is not part of qualification ${this.props.reference}`);
    }
    if ((input.severity === "major" || input.severity === "critical") && !input.capa) {
      throw ValidationError.single("capa", `${input.severity} findings require a corrective action plan`);
    }
    const finding: QualificationFinding = {
      id: newId("finding"),
      section: input.section,
      severity: input.severity,
      description: nonEmpty(input.description, "description", 1000),
      raisedAt: at,
      status: "open",
      capa: input.capa
        ? {
            action: nonEmpty(input.capa.action, "capa.action", 1000),
            ownerId: input.capa.ownerId,
            dueOn: input.capa.dueOn,
          }
        : undefined,
    };
    this.props.findings.push(finding);
    this.emit(SrmEventTypes.QualificationFindingRaised, {
      findingId: finding.id,
      severity: finding.severity,
      section: finding.section,
      capaDueOn: finding.capa?.dueOn,
    });
    return finding;
  }

  /**
   * Closes a finding once its corrective action is evidenced. Allowed after
   * completion: CAPA closure is exactly how a conditional supplier earns its
   * way back, and the service re-rates the qualification afterwards.
   */
  closeFinding(findingId: Ulid, by: UserId, at: IsoDateTime, evidence: string): QualificationFinding {
    const index = this.props.findings.findIndex((finding) => finding.id === findingId);
    if (index === -1) {
      throw new InvalidStateError(`Finding ${findingId} is not part of qualification ${this.props.reference}`);
    }
    const finding = this.props.findings[index]!;
    if (finding.status !== "open") {
      throw new InvalidStateError(`Finding ${findingId} is already ${finding.status}`);
    }
    const updated: QualificationFinding = {
      ...finding,
      status: "closed",
      closedAt: at,
      closedBy: by,
      capa: finding.capa
        ? { ...finding.capa, closedAt: at, evidence: nonEmpty(evidence, "evidence", 1000) }
        : undefined,
    };
    this.props.findings[index] = updated;
    this.emit(SrmEventTypes.QualificationFindingClosed, {
      findingId,
      severity: updated.severity,
      section: updated.section,
    });
    return updated;
  }

  /** Waiving accepts the risk instead of fixing it; observations only. */
  waiveFinding(findingId: Ulid, reason: string, at: IsoDateTime): QualificationFinding {
    const index = this.props.findings.findIndex((finding) => finding.id === findingId);
    if (index === -1) {
      throw new InvalidStateError(`Finding ${findingId} is not part of qualification ${this.props.reference}`);
    }
    const finding = this.props.findings[index]!;
    if (finding.status !== "open") {
      throw new InvalidStateError(`Finding ${findingId} is already ${finding.status}`);
    }
    if (finding.severity === "critical" || finding.severity === "major") {
      throw new InvalidStateError(`A ${finding.severity} finding cannot be waived; close it with evidence`);
    }
    const updated: QualificationFinding = {
      ...finding,
      status: "waived",
      closedAt: at,
      waivedReason: nonEmpty(reason, "reason", 500),
    };
    this.props.findings[index] = updated;
    this.touch();
    return updated;
  }

  /**
   * Completes the audit and derives the outcome. Every weighted section must
   * be scored first — an unscored section is missing evidence, not a zero.
   */
  complete(by: UserId, conductedOn: DateOnly, at: IsoDateTime, summary?: string): QualificationOutcome {
    this.assertInProgress("complete");
    const unscored = this.props.sections.filter((section) => section.score === undefined);
    if (unscored.length > 0) {
      throw new InvalidStateError(
        `Qualification ${this.props.reference} has unscored sections: ${unscored.map((s) => s.code).join(", ")}`,
        { unscored: unscored.map((s) => s.code) },
      );
    }
    const score = this.weightedScore();
    const outcome = deriveOutcome(score, this.openFindings());
    this.props.status = "completed";
    this.props.outcome = outcome;
    this.props.score = score;
    this.props.conductedOn = conductedOn;
    this.props.auditorId = this.props.auditorId ?? by;
    this.props.summary = summary?.trim() || undefined;
    this.props.conditions =
      outcome === "conditional"
        ? this.openFindings("major").map(
            (finding) => `${finding.section}: ${finding.description}${finding.capa ? ` (CAPA due ${finding.capa.dueOn})` : ""}`,
          )
        : [];
    this.props.validUntil = outcome === "failed" ? undefined : this.computeValidUntil(conductedOn, outcome);
    this.emit(SrmEventTypes.QualificationCompleted, {
      outcome,
      score,
      validUntil: this.props.validUntil,
      openFindings: this.openFindings().length,
      conductedBy: by,
    });
    return outcome;
  }

  /**
   * Re-derives the outcome after CAPA closure. A conditional result can be
   * promoted to a full pass (which also extends the validity window); nothing
   * can promote a failed audit — that needs a new one.
   */
  rerate(at: IsoDateTime): QualificationOutcome {
    if (this.props.status !== "completed") {
      throw new InvalidStateError(`Qualification ${this.props.reference} is ${this.props.status}; nothing to re-rate`);
    }
    if (this.props.outcome === "failed") {
      throw new InvalidStateError(
        `Qualification ${this.props.reference} failed; schedule a new qualification instead`,
      );
    }
    const previous = this.props.outcome;
    const outcome = deriveOutcome(this.props.score ?? this.weightedScore(), this.openFindings());
    if (outcome === previous) return previous;
    this.props.outcome = outcome;
    this.props.conditions =
      outcome === "conditional" ? this.openFindings("major").map((f) => `${f.section}: ${f.description}`) : [];
    if (this.props.conductedOn) {
      this.props.validUntil = outcome === "failed" ? undefined : this.computeValidUntil(this.props.conductedOn, outcome);
    }
    this.emit(SrmEventTypes.QualificationCompleted, {
      outcome,
      score: this.props.score ?? 0,
      validUntil: this.props.validUntil,
      openFindings: this.openFindings().length,
      conductedBy: this.props.auditorId ?? ("system" as UserId),
      rerated: true,
      previousOutcome: previous,
      at,
    });
    return outcome;
  }

  /** Sweep hook: completed qualifications lapse once validUntil passes. */
  expireIfDue(asOf: DateOnly): boolean {
    if (this.props.status !== "completed") return false;
    if (!this.props.validUntil || compareDates(this.props.validUntil, asOf) >= 0) return false;
    this.props.status = "expired";
    this.emit(SrmEventTypes.QualificationExpired, { validUntil: this.props.validUntil });
    return true;
  }

  withdraw(reason: string): void {
    if (this.props.status === "completed" || this.props.status === "expired") {
      throw new InvalidStateError(
        `Qualification ${this.props.reference} is ${this.props.status} and cannot be withdrawn`,
      );
    }
    this.props.status = "withdrawn";
    this.props.withdrawnReason = nonEmpty(reason, "reason", 500);
    this.emit(SrmEventTypes.QualificationWithdrawn, { reason: this.props.withdrawnReason });
  }

  private computeValidUntil(conductedOn: DateOnly, outcome: QualificationOutcome): DateOnly {
    // A conditional pass buys half the runway, floored at six months.
    const months =
      outcome === "conditional" ? Math.max(6, Math.floor(this.props.validityMonths / 2)) : this.props.validityMonths;
    return addMonths(conductedOn, months);
  }

  private assertInProgress(action: string): void {
    if (this.props.status !== "in_progress") {
      throw new InvalidStateError(
        `Cannot ${action}: qualification ${this.props.reference} is ${this.props.status}, expected in_progress`,
      );
    }
  }

  private emit(eventType: string, extra: Record<string, unknown> = {}): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "Qualification",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          qualificationId: this.id,
          reference: this.props.reference,
          supplierId: this.props.supplierId,
          supplierCode: this.props.supplierCode,
          categoryId: this.props.categoryId,
          type: this.props.type,
          method: this.props.method,
          status: this.props.status,
          ...extra,
        },
      }),
    );
  }
}

/**
 * Outcome rules, in order of severity:
 *  - any open critical finding fails, whatever the score;
 *  - an open major finding caps the result at conditional;
 *  - otherwise the weighted score decides against the pass thresholds.
 */
export function deriveOutcome(
  score: number,
  openFindings: readonly QualificationFinding[],
): QualificationOutcome {
  if (openFindings.some((finding) => finding.severity === "critical")) return "failed";
  const hasMajor = openFindings.some((finding) => finding.severity === "major");
  if (score < CONDITIONAL_SCORE) return "failed";
  if (hasMajor || score < PASS_SCORE) return "conditional";
  return "passed";
}

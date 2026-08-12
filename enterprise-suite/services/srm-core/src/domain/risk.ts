import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type RoleCode,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { boundedInt, nonEmpty } from "./common.js";
import { compareDates, type DateOnly } from "./dates.js";
import { InvalidStateError, RoleRequiredError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";

/**
 * Supplier risk profile: the register of risk flags and the compliance holds
 * that stop commercial activity.
 *
 * Flags are scored the way a risk register is — likelihood × impact on a 1-5
 * scale — and mitigation lowers the *residual* score without erasing the
 * inherent one, so an auditor can see both what the risk was and what was
 * done about it. The profile's tier is dominated by its worst open risk, with
 * additional open risks adding pressure: ten medium issues are worse than one,
 * but never worse than an open critical.
 *
 * Holds are the enforcement arm. They are typed by the activity they stop
 * (sourcing, PO issue, payment, shipment), scoped to the whole supplier or to
 * specific categories, and released only by the roles named when the hold was
 * placed. Services place them automatically when a certificate lapses or an
 * audit fails, and release them when the underlying fact is fixed.
 */

export type RiskCategory =
  | "financial"
  | "operational"
  | "geopolitical"
  | "cyber"
  | "esg"
  | "quality"
  | "delivery"
  | "single_source"
  | "sanctions"
  | "labor"
  | "data_privacy"
  | "regulatory";

export const RISK_CATEGORIES: readonly RiskCategory[] = [
  "financial",
  "operational",
  "geopolitical",
  "cyber",
  "esg",
  "quality",
  "delivery",
  "single_source",
  "sanctions",
  "labor",
  "data_privacy",
  "regulatory",
];

export type RiskSource = "monitoring" | "audit" | "questionnaire" | "news" | "internal" | "supplier_disclosed";

export const RISK_SOURCES: readonly RiskSource[] = [
  "monitoring",
  "audit",
  "questionnaire",
  "news",
  "internal",
  "supplier_disclosed",
];

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskFlagStatus = "open" | "mitigating" | "accepted" | "closed";

export type RiskTier = "low" | "medium" | "high" | "critical";

export function severityForScore(score: number): RiskSeverity {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function tierForProfileScore(score: number): RiskTier {
  if (score >= 70) return "critical";
  if (score >= 40) return "high";
  if (score >= 20) return "medium";
  return "low";
}

export interface RiskMitigation {
  readonly plan: string;
  readonly ownerId: UserId;
  readonly dueOn: DateOnly;
  readonly residualLikelihood: number;
  readonly residualImpact: number;
  readonly recordedAt: IsoDateTime;
}

export interface RiskFlag {
  readonly id: Ulid;
  readonly category: RiskCategory;
  readonly title: string;
  readonly description?: string;
  readonly source: RiskSource;
  readonly likelihood: number;
  readonly impact: number;
  readonly inherentScore: number;
  readonly severity: RiskSeverity;
  readonly status: RiskFlagStatus;
  readonly detectedOn: DateOnly;
  readonly reviewDueOn?: DateOnly;
  readonly ownerId?: UserId;
  readonly mitigation?: RiskMitigation;
  readonly residualScore?: number;
  readonly acceptedBy?: UserId;
  readonly acceptedReason?: string;
  readonly closedOn?: DateOnly;
  readonly closedReason?: string;
  /** Set when the flag was raised by an automated rule. */
  readonly sourceRef?: string;
}

export type HoldType = "sourcing" | "purchase_order" | "payment" | "onboarding" | "shipment";

export const HOLD_TYPES: readonly HoldType[] = ["sourcing", "purchase_order", "payment", "onboarding", "shipment"];

export type HoldReasonCode =
  | "sanctions_match"
  | "expired_certification"
  | "failed_audit"
  | "missing_tax_form"
  | "unverified_bank_details"
  | "litigation"
  | "quality_incident"
  | "credit_risk"
  | "esg_violation"
  | "data_breach"
  | "contract_expired"
  | "performance_probation";

export const HOLD_REASON_CODES: readonly HoldReasonCode[] = [
  "sanctions_match",
  "expired_certification",
  "failed_audit",
  "missing_tax_form",
  "unverified_bank_details",
  "litigation",
  "quality_incident",
  "credit_risk",
  "esg_violation",
  "data_breach",
  "contract_expired",
  "performance_probation",
];

export type HoldStatus = "active" | "released" | "expired";

export type HoldScope = "supplier" | "categories" | "sites";

export interface ComplianceHold {
  readonly id: Ulid;
  readonly type: HoldType;
  readonly reasonCode: HoldReasonCode;
  readonly scope: HoldScope;
  readonly categoryIds: readonly Ulid[];
  readonly siteIds: readonly Ulid[];
  readonly note?: string;
  readonly status: HoldStatus;
  readonly placedBy: UserId;
  readonly placedAt: IsoDateTime;
  readonly placedOn: DateOnly;
  readonly expiresOn?: DateOnly;
  /** Roles allowed to release; empty means any authenticated user. */
  readonly releaseRoles: readonly string[];
  readonly releasedBy?: UserId;
  readonly releasedOn?: DateOnly;
  readonly releaseReason?: string;
  /** Correlates an automatic hold with the fact that caused it. */
  readonly sourceRef?: string;
}

export interface RiskProfileProps {
  supplierId: Ulid;
  supplierCode: string;
  flags: RiskFlag[];
  holds: ComplianceHold[];
  tier: RiskTier;
  score: number;
  lastReviewedOn?: DateOnly;
}

export interface RaiseFlagInput {
  readonly category: RiskCategory;
  readonly title: string;
  readonly source: RiskSource;
  readonly likelihood: number;
  readonly impact: number;
  readonly detectedOn: DateOnly;
  readonly description?: string;
  readonly ownerId?: UserId;
  readonly reviewDueOn?: DateOnly;
  readonly sourceRef?: string;
}

export interface PlaceHoldInput {
  readonly type: HoldType;
  readonly reasonCode: HoldReasonCode;
  readonly placedOn: DateOnly;
  readonly scope?: HoldScope;
  readonly categoryIds?: readonly Ulid[];
  readonly siteIds?: readonly Ulid[];
  readonly note?: string;
  readonly expiresOn?: DateOnly;
  readonly releaseRoles?: readonly string[];
  readonly sourceRef?: string;
}

export class SupplierRiskProfile extends AggregateRoot<RiskProfileProps> {
  static create(tenantId: TenantId, supplierId: Ulid, supplierCode: string): SupplierRiskProfile {
    return new SupplierRiskProfile(tenantId, {
      supplierId,
      supplierCode,
      flags: [],
      holds: [],
      tier: "low",
      score: 0,
    });
  }

  static fromSnapshot(snapshot: EntityProps & RiskProfileProps): SupplierRiskProfile {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new SupplierRiskProfile(
      tenantId,
      { ...props, flags: [...props.flags], holds: [...props.holds] },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -----------------------------------------------------------

  get supplierId(): Ulid {
    return this.props.supplierId;
  }
  get supplierCode(): string {
    return this.props.supplierCode;
  }
  get flags(): readonly RiskFlag[] {
    return this.props.flags;
  }
  get holds(): readonly ComplianceHold[] {
    return this.props.holds;
  }
  get tier(): RiskTier {
    return this.props.tier;
  }
  get score(): number {
    return this.props.score;
  }

  flag(flagId: Ulid): RiskFlag | undefined {
    return this.props.flags.find((entry) => entry.id === flagId);
  }

  openFlags(): readonly RiskFlag[] {
    return this.props.flags.filter((entry) => entry.status === "open" || entry.status === "mitigating");
  }

  activeHolds(): readonly ComplianceHold[] {
    return this.props.holds.filter((hold) => hold.status === "active");
  }

  hold(holdId: Ulid): ComplianceHold | undefined {
    return this.props.holds.find((entry) => entry.id === holdId);
  }

  flagsDueForReview(asOf: DateOnly): readonly RiskFlag[] {
    return this.openFlags().filter(
      (entry) => entry.reviewDueOn !== undefined && compareDates(entry.reviewDueOn, asOf) <= 0,
    );
  }

  /**
   * Holds that stop the given activity. A `sourcing` hold also stops purchase
   * orders — you cannot issue a PO for work you are not allowed to source.
   */
  blockingHolds(activity: HoldType, options: { categoryId?: Ulid; siteId?: Ulid } = {}): readonly ComplianceHold[] {
    return this.activeHolds().filter((hold) => {
      const stopsActivity = hold.type === activity || (hold.type === "sourcing" && activity === "purchase_order");
      if (!stopsActivity) return false;
      if (hold.scope === "supplier") return true;
      if (hold.scope === "categories") {
        return options.categoryId === undefined || hold.categoryIds.includes(options.categoryId);
      }
      return options.siteId === undefined || hold.siteIds.includes(options.siteId);
    });
  }

  isBlocked(activity: HoldType, options: { categoryId?: Ulid; siteId?: Ulid } = {}): boolean {
    return this.blockingHolds(activity, options).length > 0;
  }

  // --- risk flags ----------------------------------------------------------

  raiseFlag(input: RaiseFlagInput, at: IsoDateTime): RiskFlag {
    if (!RISK_CATEGORIES.includes(input.category)) {
      throw ValidationError.single("category", `must be one of [${RISK_CATEGORIES.join(", ")}]`);
    }
    if (!RISK_SOURCES.includes(input.source)) {
      throw ValidationError.single("source", `must be one of [${RISK_SOURCES.join(", ")}]`);
    }
    const likelihood = boundedInt(input.likelihood, "likelihood", 1, 5);
    const impact = boundedInt(input.impact, "impact", 1, 5);
    if (input.sourceRef && this.props.flags.some((entry) => entry.sourceRef === input.sourceRef && entry.status !== "closed")) {
      throw new InvalidStateError(`An open flag already tracks ${input.sourceRef}`);
    }
    const inherentScore = likelihood * impact;
    const flag: RiskFlag = {
      id: newId("risk"),
      category: input.category,
      title: nonEmpty(input.title, "title", 300),
      description: input.description?.trim() || undefined,
      source: input.source,
      likelihood,
      impact,
      inherentScore,
      severity: severityForScore(inherentScore),
      status: "open",
      detectedOn: input.detectedOn,
      reviewDueOn: input.reviewDueOn,
      ownerId: input.ownerId,
      sourceRef: input.sourceRef,
    };
    this.props.flags.push(flag);
    this.emit(SrmEventTypes.RiskFlagRaised, {
      flagId: flag.id,
      category: flag.category,
      severity: flag.severity,
      inherentScore: flag.inherentScore,
      status: flag.status,
      source: flag.source,
      detectedOn: flag.detectedOn,
      title: flag.title,
    });
    this.rescore(at);
    return flag;
  }

  /**
   * Attaches a mitigation plan and the residual exposure it buys. The
   * residual can never exceed the inherent score — mitigation reduces risk,
   * it does not discover new risk (that is a new flag).
   */
  mitigateFlag(
    flagId: Ulid,
    input: { plan: string; ownerId: UserId; dueOn: DateOnly; residualLikelihood: number; residualImpact: number },
    at: IsoDateTime,
  ): RiskFlag {
    const index = this.requireFlagIndex(flagId);
    const flag = this.props.flags[index]!;
    if (flag.status === "closed") throw new InvalidStateError(`Risk flag ${flagId} is closed`);
    const residualLikelihood = boundedInt(input.residualLikelihood, "residualLikelihood", 1, 5);
    const residualImpact = boundedInt(input.residualImpact, "residualImpact", 1, 5);
    const residualScore = residualLikelihood * residualImpact;
    if (residualScore > flag.inherentScore) {
      throw ValidationError.single(
        "residualLikelihood",
        `residual score ${residualScore} exceeds the inherent score ${flag.inherentScore}`,
      );
    }
    const updated: RiskFlag = {
      ...flag,
      status: "mitigating",
      mitigation: {
        plan: nonEmpty(input.plan, "plan", 1000),
        ownerId: input.ownerId,
        dueOn: input.dueOn,
        residualLikelihood,
        residualImpact,
        recordedAt: at,
      },
      residualScore,
      severity: severityForScore(residualScore),
    };
    this.props.flags[index] = updated;
    this.emit(SrmEventTypes.RiskFlagMitigated, {
      flagId,
      category: updated.category,
      severity: updated.severity,
      inherentScore: updated.inherentScore,
      residualScore,
      status: updated.status,
      source: updated.source,
      detectedOn: updated.detectedOn,
    });
    this.rescore(at);
    return updated;
  }

  /** Formal risk acceptance: the exposure stays, ownership is explicit. */
  acceptFlag(flagId: Ulid, by: UserId, reason: string, at: IsoDateTime): RiskFlag {
    const index = this.requireFlagIndex(flagId);
    const flag = this.props.flags[index]!;
    if (flag.status === "closed") throw new InvalidStateError(`Risk flag ${flagId} is closed`);
    if (flag.severity === "critical") {
      throw new InvalidStateError("A critical risk cannot be accepted; mitigate or close it");
    }
    const updated: RiskFlag = {
      ...flag,
      status: "accepted",
      acceptedBy: by,
      acceptedReason: nonEmpty(reason, "reason", 1000),
    };
    this.props.flags[index] = updated;
    this.emit(SrmEventTypes.RiskFlagAccepted, {
      flagId,
      category: updated.category,
      severity: updated.severity,
      inherentScore: updated.inherentScore,
      residualScore: updated.residualScore,
      status: updated.status,
      source: updated.source,
      detectedOn: updated.detectedOn,
    });
    this.rescore(at);
    return updated;
  }

  closeFlag(flagId: Ulid, reason: string, closedOn: DateOnly, at: IsoDateTime): RiskFlag {
    const index = this.requireFlagIndex(flagId);
    const flag = this.props.flags[index]!;
    if (flag.status === "closed") throw new InvalidStateError(`Risk flag ${flagId} is already closed`);
    const updated: RiskFlag = {
      ...flag,
      status: "closed",
      closedOn,
      closedReason: nonEmpty(reason, "reason", 500),
    };
    this.props.flags[index] = updated;
    this.emit(SrmEventTypes.RiskFlagClosed, {
      flagId,
      category: updated.category,
      severity: updated.severity,
      inherentScore: updated.inherentScore,
      residualScore: updated.residualScore,
      status: updated.status,
      source: updated.source,
      detectedOn: updated.detectedOn,
    });
    this.rescore(at);
    return updated;
  }

  // --- compliance holds ----------------------------------------------------

  placeHold(input: PlaceHoldInput, by: UserId, at: IsoDateTime): ComplianceHold {
    if (!HOLD_TYPES.includes(input.type)) {
      throw ValidationError.single("type", `must be one of [${HOLD_TYPES.join(", ")}]`);
    }
    if (!HOLD_REASON_CODES.includes(input.reasonCode)) {
      throw ValidationError.single("reasonCode", `must be one of [${HOLD_REASON_CODES.join(", ")}]`);
    }
    const scope = input.scope ?? "supplier";
    if (scope === "categories" && (input.categoryIds ?? []).length === 0) {
      throw ValidationError.single("categoryIds", "a category-scoped hold needs at least one category");
    }
    if (scope === "sites" && (input.siteIds ?? []).length === 0) {
      throw ValidationError.single("siteIds", "a site-scoped hold needs at least one site");
    }
    const duplicate = this.activeHolds().find(
      (hold) => hold.type === input.type && hold.reasonCode === input.reasonCode && hold.scope === scope,
    );
    if (duplicate) {
      throw new InvalidStateError(
        `A ${input.type} hold for ${input.reasonCode} is already active on ${this.props.supplierCode}`,
        { holdId: duplicate.id },
      );
    }
    const hold: ComplianceHold = {
      id: newId("hold"),
      type: input.type,
      reasonCode: input.reasonCode,
      scope,
      categoryIds: [...(input.categoryIds ?? [])],
      siteIds: [...(input.siteIds ?? [])],
      note: input.note?.trim() || undefined,
      status: "active",
      placedBy: by,
      placedAt: at,
      placedOn: input.placedOn,
      expiresOn: input.expiresOn,
      releaseRoles: [...(input.releaseRoles ?? [])],
      sourceRef: input.sourceRef,
    };
    this.props.holds.push(hold);
    this.emit(SrmEventTypes.HoldPlaced, {
      holdId: hold.id,
      holdType: hold.type,
      reasonCode: hold.reasonCode,
      scope: hold.scope,
      categoryIds: hold.categoryIds,
      placedBy: by,
      note: hold.note,
      expiresOn: hold.expiresOn,
    });
    return hold;
  }

  /**
   * Releases a hold. When the hold names release roles, the acting user must
   * hold one of them — a buyer cannot lift the compliance team's sanctions
   * hold on their own supplier.
   */
  releaseHold(
    holdId: Ulid,
    by: UserId,
    roles: readonly RoleCode[],
    reason: string,
    releasedOn: DateOnly,
  ): ComplianceHold {
    const index = this.props.holds.findIndex((hold) => hold.id === holdId);
    if (index === -1) {
      throw new InvalidStateError(`Hold ${holdId} is not on supplier ${this.props.supplierCode}`);
    }
    const hold = this.props.holds[index]!;
    if (hold.status !== "active") {
      throw new InvalidStateError(`Hold ${holdId} is already ${hold.status}`);
    }
    if (hold.releaseRoles.length > 0 && !roles.some((role) => hold.releaseRoles.includes(role))) {
      throw new RoleRequiredError(`Releasing the ${hold.reasonCode} hold`, hold.releaseRoles);
    }
    const updated: ComplianceHold = {
      ...hold,
      status: "released",
      releasedBy: by,
      releasedOn,
      releaseReason: nonEmpty(reason, "reason", 500),
    };
    this.props.holds[index] = updated;
    this.emit(SrmEventTypes.HoldReleased, {
      holdId,
      holdType: updated.type,
      reasonCode: updated.reasonCode,
      scope: updated.scope,
      categoryIds: updated.categoryIds,
      releasedBy: by,
      note: updated.releaseReason,
    });
    return updated;
  }

  /** Sweep hook: time-boxed holds fall away on their own. */
  expireHolds(asOf: DateOnly): readonly ComplianceHold[] {
    const expired: ComplianceHold[] = [];
    this.props.holds = this.props.holds.map((hold) => {
      if (hold.status !== "active" || !hold.expiresOn || compareDates(hold.expiresOn, asOf) >= 0) return hold;
      const updated: ComplianceHold = { ...hold, status: "expired" };
      expired.push(updated);
      return updated;
    });
    for (const hold of expired) {
      this.emit(SrmEventTypes.HoldExpired, {
        holdId: hold.id,
        holdType: hold.type,
        reasonCode: hold.reasonCode,
        scope: hold.scope,
        categoryIds: hold.categoryIds,
        expiresOn: hold.expiresOn,
      });
    }
    return expired;
  }

  /** Lifts the automatic hold(s) raised for a fact that has since been fixed. */
  releaseHoldsBySourceRef(sourceRef: string, by: UserId, reason: string, releasedOn: DateOnly): readonly ComplianceHold[] {
    const released: ComplianceHold[] = [];
    for (const hold of this.activeHolds().filter((entry) => entry.sourceRef === sourceRef)) {
      released.push(this.releaseHold(hold.id, by, [], reason, releasedOn));
    }
    return released;
  }

  markReviewed(asOf: DateOnly): void {
    this.props.lastReviewedOn = asOf;
    this.touch();
  }

  // --- scoring -------------------------------------------------------------

  /**
   * The worst open risk dominates the profile score; every other open risk
   * adds a smaller amount of pressure. Both parts are on the 1-25 flag scale,
   * projected onto 0-100 and capped.
   */
  private rescore(at: IsoDateTime): void {
    const open = this.openFlags();
    const effective = open.map((flag) => flag.residualScore ?? flag.inherentScore).sort((a, b) => b - a);
    const dominant = effective[0] ?? 0;
    const rest = effective.slice(1).reduce((sum, score) => sum + score, 0);
    const score = Math.min(100, Math.round(dominant * 3.6 + rest * 0.6));
    const tier = tierForProfileScore(score);
    const previousTier = this.props.tier;
    this.props.score = score;
    this.props.tier = tier;
    if (tier !== previousTier) {
      this.raise(
        envelope({
          eventType: SrmEventTypes.RiskTierChanged,
          aggregateType: "SupplierRiskProfile",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            supplierId: this.props.supplierId,
            supplierCode: this.props.supplierCode,
            from: previousTier,
            to: tier,
            score,
            openFlags: open.length,
            changedAt: at,
          },
        }),
      );
    } else {
      this.touch();
    }
  }

  private requireFlagIndex(flagId: Ulid): number {
    const index = this.props.flags.findIndex((flag) => flag.id === flagId);
    if (index === -1) {
      throw new InvalidStateError(`Risk flag ${flagId} is not on supplier ${this.props.supplierCode}`);
    }
    return index;
  }

  private emit(eventType: string, payload: Record<string, unknown>): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "SupplierRiskProfile",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { supplierId: this.props.supplierId, supplierCode: this.props.supplierCode, ...payload },
      }),
    );
  }
}

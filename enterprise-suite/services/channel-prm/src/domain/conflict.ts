import {
  AggregateRoot,
  envelope,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError, ValidationError } from "./errors.js";
import { ChannelEventTypes } from "./events.js";
import { addDays, daysBetween, overlapDays, type Interval } from "./protection.js";
import { STAGE_ORDER, type ChannelStage } from "./stages.js";
import { productLineOverlap, type CustomerKey } from "./territory.js";

/**
 * Channel conflict detection and adjudication.
 *
 * Two things live here: a pure detector that answers "does this registration
 * collide with something already in play?", and the case aggregate the channel
 * team works to a decision. Detection is deliberately pure and side-effect
 * free so the partner portal can run it as a *pre-check* before a partner
 * spends time filling in a registration.
 */

export type ConflictKind =
  | "duplicate_registration"
  | "partner_vs_partner"
  | "partner_vs_pending"
  | "partner_vs_direct";

export const CONFLICT_KINDS: readonly ConflictKind[] = [
  "duplicate_registration",
  "partner_vs_partner",
  "partner_vs_pending",
  "partner_vs_direct",
];

export type ConflictSeverity = "blocking" | "advisory";

export type ConflictOutcome =
  | "incumbent_upheld"
  | "claimant_awarded"
  | "co_sell"
  | "split"
  | "both_rejected";

export const CONFLICT_OUTCOMES: readonly ConflictOutcome[] = [
  "incumbent_upheld",
  "claimant_awarded",
  "co_sell",
  "split",
  "both_rejected",
];

export type ConflictStatus = "open" | "under_review" | "resolved" | "withdrawn";

/** Minimal projection of a registration the detector needs. */
export interface RegistrationClaim {
  readonly registrationId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly customerKey: CustomerKey;
  readonly productLines: readonly string[];
  readonly status: string;
  readonly stage: ChannelStage;
  readonly estimatedValue: Money;
  /** Present once approved. */
  readonly protection?: Interval;
  /** Last forecast/detail change; a stale claim carries less weight. */
  readonly lastActivityAt: IsoDateTime;
  readonly quoteCount: number;
  readonly orderCount: number;
}

/** A vendor-owned (house) account that partners may not register against. */
export interface DirectClaim {
  readonly customerKey: CustomerKey;
  readonly reason: string;
  readonly productLines?: readonly string[];
  readonly ownerId?: UserId;
}

export interface ConflictFinding {
  readonly kind: ConflictKind;
  readonly severity: ConflictSeverity;
  readonly customerKey: CustomerKey;
  readonly overlappingProductLines: readonly string[];
  readonly incumbentRegistrationId?: Ulid;
  readonly incumbentNumber?: string;
  readonly incumbentPartnerId?: Ulid;
  readonly incumbentProtectionEndsAt?: IsoDateTime;
  readonly overlapDays: number;
  readonly explanation: string;
}

export interface DetectionInput {
  readonly customerKey: CustomerKey;
  readonly partnerId: Ulid;
  readonly productLines: readonly string[];
  /** Window the candidate would receive if approved now. */
  readonly requestedWindow: Interval;
  readonly existing: readonly RegistrationClaim[];
  readonly directClaims?: readonly DirectClaim[];
  readonly at: IsoDateTime;
}

const OPEN_STATUSES = new Set(["submitted", "under_review"]);

/**
 * Finds every reason a candidate registration should not simply be waved
 * through. Blocking findings stop submission; advisory findings are recorded
 * on the case and shown to the reviewer.
 */
export function detectConflicts(input: DetectionInput): ConflictFinding[] {
  const findings: ConflictFinding[] = [];

  for (const claim of input.directClaims ?? []) {
    if (claim.customerKey !== input.customerKey) continue;
    const overlap = claim.productLines
      ? productLineOverlap(input.productLines, claim.productLines)
      : [...input.productLines];
    if (overlap.length === 0) continue;
    findings.push({
      kind: "partner_vs_direct",
      severity: "blocking",
      customerKey: input.customerKey,
      overlappingProductLines: overlap,
      overlapDays: 0,
      explanation: `${input.customerKey} is a house account (${claim.reason}); partner registrations are not accepted`,
    });
  }

  for (const claim of input.existing) {
    if (claim.customerKey !== input.customerKey) continue;
    const overlap = productLineOverlap(input.productLines, claim.productLines);
    if (overlap.length === 0) continue;

    const protectedNow =
      !!claim.protection &&
      Date.parse(input.at) >= Date.parse(claim.protection.startsAt) &&
      Date.parse(input.at) < Date.parse(claim.protection.endsAt);
    const shared = claim.protection ? overlapDays(input.requestedWindow, claim.protection) : 0;

    if (claim.partnerId === input.partnerId) {
      if (protectedNow || OPEN_STATUSES.has(claim.status)) {
        findings.push({
          kind: "duplicate_registration",
          severity: "blocking",
          customerKey: input.customerKey,
          overlappingProductLines: overlap,
          incumbentRegistrationId: claim.registrationId,
          incumbentNumber: claim.number,
          incumbentPartnerId: claim.partnerId,
          incumbentProtectionEndsAt: claim.protection?.endsAt,
          overlapDays: Math.round(shared),
          explanation: `You already have ${claim.number} on this customer for ${overlap.join(", ")}`,
        });
      }
      continue;
    }

    if (protectedNow) {
      findings.push({
        kind: "partner_vs_partner",
        severity: "blocking",
        customerKey: input.customerKey,
        overlappingProductLines: overlap,
        incumbentRegistrationId: claim.registrationId,
        incumbentNumber: claim.number,
        incumbentPartnerId: claim.partnerId,
        incumbentProtectionEndsAt: claim.protection?.endsAt,
        overlapDays: Math.round(shared),
        explanation:
          `Another partner holds protection on this customer for ${overlap.join(", ")} ` +
          `until ${claim.protection?.endsAt}`,
      });
    } else if (OPEN_STATUSES.has(claim.status)) {
      findings.push({
        kind: "partner_vs_pending",
        severity: "advisory",
        customerKey: input.customerKey,
        overlappingProductLines: overlap,
        incumbentRegistrationId: claim.registrationId,
        incumbentNumber: claim.number,
        incumbentPartnerId: claim.partnerId,
        overlapDays: 0,
        explanation: `Another partner registered this customer first (${claim.number}) and is awaiting a decision`,
      });
    }
  }

  return findings;
}

export function hasBlockingFinding(findings: readonly ConflictFinding[]): boolean {
  return findings.some((f) => f.severity === "blocking");
}

export interface ClaimScore {
  readonly registrationId: Ulid;
  readonly score: number;
  readonly factors: readonly { readonly factor: string; readonly points: number; readonly note: string }[];
}

/**
 * Scores a claim on the evidence a channel manager actually weighs: how far
 * the deal has moved, whether real documents exist, how recently anything
 * happened, and how much protection time is left. Deliberately explainable —
 * every point comes back with the reason it was awarded, because partners
 * challenge these decisions.
 */
export function scoreClaim(claim: RegistrationClaim, at: IsoDateTime): ClaimScore {
  const factors: { factor: string; points: number; note: string }[] = [];

  const stagePoints = STAGE_ORDER[claim.stage] * 10;
  factors.push({ factor: "stage", points: stagePoints, note: `stage ${claim.stage}` });

  const documentPoints = Math.min(claim.quoteCount, 3) * 8 + Math.min(claim.orderCount, 2) * 15;
  if (documentPoints > 0) {
    factors.push({
      factor: "documents",
      points: documentPoints,
      note: `${claim.quoteCount} quote(s), ${claim.orderCount} order(s)`,
    });
  }

  const idleDays = Math.max(0, daysBetween(claim.lastActivityAt, at));
  const stalePenalty = idleDays > 30 ? -Math.min(30, Math.round((idleDays - 30) / 2)) : 0;
  if (stalePenalty !== 0) {
    factors.push({ factor: "staleness", points: stalePenalty, note: `${Math.round(idleDays)} days without activity` });
  }

  if (claim.protection) {
    const left = daysBetween(at, claim.protection.endsAt);
    const protectionPoints = left <= 0 ? 0 : Math.min(20, Math.round(left / 3));
    factors.push({
      factor: "protection",
      points: protectionPoints,
      note: left <= 0 ? "protection lapsed" : `${Math.round(left)} days of protection left`,
    });
  }

  const score = factors.reduce((sum, f) => sum + f.points, 0);
  return { registrationId: claim.registrationId, score, factors };
}

export interface Recommendation {
  readonly outcome: ConflictOutcome;
  readonly rationale: string;
  readonly claimantScore: ClaimScore;
  readonly incumbentScore?: ClaimScore;
}

/**
 * Recommends an outcome. First-to-register is the default and only loses when
 * the incumbent is measurably disengaged: the margin has to be decisive
 * (>= 25 points) before a held position is taken away, and a close call
 * becomes co-sell rather than a coin flip.
 */
export function recommendOutcome(
  claimant: RegistrationClaim,
  incumbent: RegistrationClaim | undefined,
  at: IsoDateTime,
): Recommendation {
  const claimantScore = scoreClaim(claimant, at);
  if (!incumbent) {
    return {
      outcome: "claimant_awarded",
      rationale: "No incumbent claim remains; the registration stands on its own",
      claimantScore,
    };
  }
  const incumbentScore = scoreClaim(incumbent, at);
  const margin = claimantScore.score - incumbentScore.score;

  if (margin >= 25) {
    return {
      outcome: "claimant_awarded",
      rationale:
        `Claimant is materially further along (${claimantScore.score} vs ${incumbentScore.score}); ` +
        `the incumbent position looks abandoned`,
      claimantScore,
      incumbentScore,
    };
  }
  if (margin > 10) {
    return {
      outcome: "co_sell",
      rationale:
        `Both partners have real engagement (${claimantScore.score} vs ${incumbentScore.score}); ` +
        `neither claim is strong enough to displace the other`,
      claimantScore,
      incumbentScore,
    };
  }
  return {
    outcome: "incumbent_upheld",
    rationale:
      `Incumbent registered first and remains engaged (${incumbentScore.score} vs ${claimantScore.score}); ` +
      `first-to-register stands`,
    claimantScore,
    incumbentScore,
  };
}

export interface ConflictEvidence {
  readonly id: Ulid;
  readonly at: IsoDateTime;
  readonly by: UserId;
  /** Which side (or the vendor) submitted it. */
  readonly source: "claimant" | "incumbent" | "vendor";
  readonly note: string;
}

export interface ConflictResolution {
  readonly outcome: ConflictOutcome;
  readonly rationale: string;
  readonly decidedBy: UserId;
  readonly decidedAt: IsoDateTime;
  readonly awardedRegistrationId?: Ulid;
  /** Claimant's share of the credit for a split, in basis points. */
  readonly splitBps?: number;
}

export interface ConflictCaseProps {
  number: string;
  kind: ConflictKind;
  customerKey: CustomerKey;
  claimantRegistrationId: Ulid;
  claimantPartnerId: Ulid;
  incumbentRegistrationId?: Ulid;
  incumbentPartnerId?: Ulid;
  overlappingProductLines: string[];
  overlapDays: number;
  status: ConflictStatus;
  severity: ConflictSeverity;
  recommendedOutcome: ConflictOutcome;
  recommendationRationale: string;
  raisedAt: IsoDateTime;
  slaDueAt: IsoDateTime;
  escalationLevel: number;
  escalatedAt?: IsoDateTime;
  reviewerId?: UserId;
  evidence: ConflictEvidence[];
  resolution?: ConflictResolution;
  withdrawnReason?: string;
}

export interface RaiseConflictInput {
  readonly number: string;
  readonly finding: ConflictFinding;
  readonly claimantRegistrationId: Ulid;
  readonly claimantPartnerId: Ulid;
  readonly recommendation: Recommendation;
  readonly raisedAt: IsoDateTime;
  readonly slaHours: number;
}

const MAX_ESCALATION_LEVEL = 3;

export class ConflictCase extends AggregateRoot<ConflictCaseProps> {
  static openCase(tenantId: TenantId, input: RaiseConflictInput): ConflictCase {
    const conflict = new ConflictCase(tenantId, {
      number: input.number,
      kind: input.finding.kind,
      customerKey: input.finding.customerKey,
      claimantRegistrationId: input.claimantRegistrationId,
      claimantPartnerId: input.claimantPartnerId,
      incumbentRegistrationId: input.finding.incumbentRegistrationId,
      incumbentPartnerId: input.finding.incumbentPartnerId,
      overlappingProductLines: [...input.finding.overlappingProductLines],
      overlapDays: input.finding.overlapDays,
      status: "open",
      severity: input.finding.severity,
      recommendedOutcome: input.recommendation.outcome,
      recommendationRationale: input.recommendation.rationale,
      raisedAt: input.raisedAt,
      slaDueAt: addDays(input.raisedAt, input.slaHours / 24),
      escalationLevel: 0,
      evidence: [],
    });
    conflict.raise(
      envelope({
        eventType: ChannelEventTypes.ConflictRaised,
        aggregateType: "ConflictCase",
        aggregateId: conflict.id,
        tenantId,
        payload: {
          ...conflict.basePayload(),
          overlappingProductLines: conflict.props.overlappingProductLines,
          overlapDays: conflict.props.overlapDays,
          recommendedOutcome: conflict.props.recommendedOutcome,
          slaDueAt: conflict.props.slaDueAt,
        },
      }),
    );
    return conflict;
  }

  static fromSnapshot(snapshot: EntityProps & ConflictCaseProps): ConflictCase {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new ConflictCase(
      tenantId,
      { ...props, overlappingProductLines: [...props.overlappingProductLines], evidence: [...props.evidence] },
      { id, createdAt, updatedAt, version },
    );
  }

  get number(): string {
    return this.props.number;
  }
  get kind(): ConflictKind {
    return this.props.kind;
  }
  get status(): ConflictStatus {
    return this.props.status;
  }
  get customerKey(): CustomerKey {
    return this.props.customerKey;
  }
  get claimantRegistrationId(): Ulid {
    return this.props.claimantRegistrationId;
  }
  get incumbentRegistrationId(): Ulid | undefined {
    return this.props.incumbentRegistrationId;
  }
  get claimantPartnerId(): Ulid {
    return this.props.claimantPartnerId;
  }
  get incumbentPartnerId(): Ulid | undefined {
    return this.props.incumbentPartnerId;
  }
  get overlappingProductLines(): readonly string[] {
    return this.props.overlappingProductLines;
  }
  get recommendedOutcome(): ConflictOutcome {
    return this.props.recommendedOutcome;
  }
  get resolution(): ConflictResolution | undefined {
    return this.props.resolution;
  }
  get evidence(): readonly ConflictEvidence[] {
    return this.props.evidence;
  }
  get slaDueAt(): IsoDateTime {
    return this.props.slaDueAt;
  }
  get escalationLevel(): number {
    return this.props.escalationLevel;
  }
  get raisedAt(): IsoDateTime {
    return this.props.raisedAt;
  }

  isOverdueAt(at: IsoDateTime): boolean {
    return this.isOpen() && Date.parse(at) >= Date.parse(this.props.slaDueAt);
  }

  isOpen(): boolean {
    return this.props.status === "open" || this.props.status === "under_review";
  }

  addEvidence(input: { by: UserId; at: IsoDateTime; source: ConflictEvidence["source"]; note: string }): ConflictEvidence {
    if (!this.isOpen()) {
      throw new InvalidStateError(`Conflict ${this.props.number} is ${this.props.status}; evidence is closed`);
    }
    if (input.note.trim().length < 5) {
      throw ValidationError.single("note", "evidence must be at least 5 characters");
    }
    const entry: ConflictEvidence = {
      id: newId("cnfev"),
      at: input.at,
      by: input.by,
      source: input.source,
      note: input.note.trim(),
    };
    this.props.evidence.push(entry);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ConflictEvidenceAdded,
        aggregateType: "ConflictCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), source: entry.source, evidenceId: entry.id },
      }),
    );
    return entry;
  }

  startReview(by: UserId): void {
    if (this.props.status !== "open") {
      throw new InvalidStateError(`Conflict ${this.props.number} is ${this.props.status}; it cannot enter review`);
    }
    this.props.status = "under_review";
    this.props.reviewerId = by;
    this.touch();
  }

  escalate(input: { by: UserId; at: IsoDateTime; reason: string }): void {
    if (!this.isOpen()) {
      throw new InvalidStateError(`Conflict ${this.props.number} is ${this.props.status} and cannot be escalated`);
    }
    if (this.props.escalationLevel >= MAX_ESCALATION_LEVEL) {
      throw new InvalidStateError(
        `Conflict ${this.props.number} is already at the highest escalation level (${MAX_ESCALATION_LEVEL})`,
      );
    }
    if (input.reason.trim().length === 0) {
      throw ValidationError.single("reason", "an escalation reason is required");
    }
    this.props.escalationLevel += 1;
    this.props.escalatedAt = input.at;
    // Each escalation halves the remaining clock, floored at four hours.
    const remaining = Math.max(4, daysBetween(input.at, this.props.slaDueAt) * 24) / 2;
    this.props.slaDueAt = addDays(input.at, remaining / 24);
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ConflictEscalated,
        aggregateType: "ConflictCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          escalationLevel: this.props.escalationLevel,
          reason: input.reason.trim(),
          slaDueAt: this.props.slaDueAt,
        },
      }),
    );
  }

  /**
   * Records the decision. The aggregate validates that the outcome is coherent
   * with the parties on the case; applying it to the registrations (awarding
   * protection, truncating the loser's window) is the service's job.
   */
  resolve(input: {
    by: UserId;
    at: IsoDateTime;
    outcome: ConflictOutcome;
    rationale: string;
    splitBps?: number;
  }): ConflictResolution {
    if (!this.isOpen()) {
      throw new InvalidStateError(`Conflict ${this.props.number} is already ${this.props.status}`);
    }
    if (!CONFLICT_OUTCOMES.includes(input.outcome)) {
      throw ValidationError.single("outcome", `must be one of [${CONFLICT_OUTCOMES.join(", ")}]`);
    }
    if (input.rationale.trim().length < 10) {
      throw ValidationError.single("rationale", "a rationale of at least 10 characters is required");
    }
    const twoSided = input.outcome === "co_sell" || input.outcome === "split" || input.outcome === "incumbent_upheld";
    if (twoSided && !this.props.incumbentRegistrationId) {
      throw new InvalidStateError(
        `Conflict ${this.props.number} has no incumbent registration; "${input.outcome}" is not a valid outcome`,
      );
    }
    if (input.outcome === "split") {
      if (input.splitBps === undefined || !Number.isInteger(input.splitBps) || input.splitBps < 1 || input.splitBps > 9_999) {
        throw ValidationError.single("splitBps", "a split requires a claimant share between 1 and 9999 basis points");
      }
    } else if (input.splitBps !== undefined) {
      throw ValidationError.single("splitBps", `is only meaningful for a "split" outcome`);
    }

    const awardedRegistrationId =
      input.outcome === "claimant_awarded"
        ? this.props.claimantRegistrationId
        : input.outcome === "incumbent_upheld"
          ? this.props.incumbentRegistrationId
          : undefined;

    const resolution: ConflictResolution = {
      outcome: input.outcome,
      rationale: input.rationale.trim(),
      decidedBy: input.by,
      decidedAt: input.at,
      awardedRegistrationId,
      splitBps: input.splitBps,
    };
    this.props.status = "resolved";
    this.props.resolution = resolution;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ConflictResolved,
        aggregateType: "ConflictCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          ...this.basePayload(),
          outcome: input.outcome,
          decidedBy: input.by,
          rationale: resolution.rationale,
          awardedRegistrationId,
          splitBps: input.splitBps,
          resolutionDays: Math.max(0, Math.round(daysBetween(this.props.raisedAt, input.at))),
        },
      }),
    );
    return resolution;
  }

  withdraw(input: { by: UserId; at: IsoDateTime; reason: string }): void {
    if (!this.isOpen()) {
      throw new InvalidStateError(`Conflict ${this.props.number} is already ${this.props.status}`);
    }
    if (input.reason.trim().length === 0) {
      throw ValidationError.single("reason", "a withdrawal reason is required");
    }
    this.props.status = "withdrawn";
    this.props.withdrawnReason = input.reason.trim();
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ConflictWithdrawn,
        aggregateType: "ConflictCase",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.basePayload(), reason: input.reason.trim() },
      }),
    );
  }

  private basePayload() {
    return {
      conflictId: this.id,
      number: this.props.number,
      kind: this.props.kind,
      customerKey: this.props.customerKey,
      claimantRegistrationId: this.props.claimantRegistrationId,
      incumbentRegistrationId: this.props.incumbentRegistrationId,
    };
  }
}

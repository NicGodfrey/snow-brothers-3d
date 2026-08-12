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
import { compareDates, daysBetween, type DateOnly } from "./dates.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { SrmEventTypes } from "./events.js";
import { bandForScore, weightedAverage, type KpiBand } from "./kpi.js";
import type { PerformancePeriod } from "./period.js";

/**
 * Supplier scorecard for one performance period.
 *
 *   draft -> in_review -> published -> closed
 *                            ^  |
 *                            |  v
 *                          disputed
 *
 * Measurements are snapshots: the KPI's weight, target and scoring band are
 * copied onto the measurement when it is recorded, so re-tuning a KPI
 * definition next quarter never silently rewrites history. Publishing is the
 * commitment point — it needs every mandatory KPI, computes the weighted
 * score and rating, and a `watch`/`probation` rating opens a mandatory
 * improvement plan that has to be worked off before the period can be closed.
 * A supplier can dispute a published scorecard inside a window; resolving the
 * dispute may adjust measurements, and every adjustment keeps the original
 * value and a reason.
 */

export type ScorecardStatus = "draft" | "in_review" | "published" | "disputed" | "closed";

export type SupplierRating = "excellent" | "good" | "acceptable" | "watch" | "probation";

export const SUPPLIER_RATINGS: readonly SupplierRating[] = [
  "excellent",
  "good",
  "acceptable",
  "watch",
  "probation",
];

/** Score floors for each rating band. */
export const RATING_THRESHOLDS: readonly { readonly rating: SupplierRating; readonly minScore: number }[] = [
  { rating: "excellent", minScore: 90 },
  { rating: "good", minScore: 80 },
  { rating: "acceptable", minScore: 70 },
  { rating: "watch", minScore: 55 },
  { rating: "probation", minScore: 0 },
];

export function ratingForScore(score: number): SupplierRating {
  return RATING_THRESHOLDS.find((threshold) => score >= threshold.minScore)?.rating ?? "probation";
}

/** Ratings that force a documented improvement plan. */
export function requiresImprovementPlan(rating: SupplierRating): boolean {
  return rating === "watch" || rating === "probation";
}

export const DEFAULT_DISPUTE_WINDOW_DAYS = 30;

export interface MeasurementAdjustment {
  readonly previousValue: number;
  readonly previousScore: number;
  readonly reason: string;
  readonly adjustedAt: IsoDateTime;
  readonly adjustedBy: UserId;
}

export interface ScorecardMeasurement {
  readonly kpiCode: string;
  readonly kpiName: string;
  readonly value: number;
  readonly score: number;
  readonly band: KpiBand;
  readonly weight: number;
  readonly target: number;
  readonly unit: string;
  readonly mandatory: boolean;
  readonly source: string;
  readonly recordedAt: IsoDateTime;
  readonly recordedBy: UserId;
  readonly note?: string;
  readonly adjustments: readonly MeasurementAdjustment[];
}

export type ImprovementActionStatus = "open" | "in_progress" | "completed" | "cancelled";

export interface ImprovementAction {
  readonly id: Ulid;
  readonly title: string;
  readonly kpiCode?: string;
  readonly ownerId: UserId;
  readonly dueOn: DateOnly;
  readonly status: ImprovementActionStatus;
  readonly createdAt: IsoDateTime;
  readonly completedAt?: IsoDateTime;
  readonly outcome?: string;
}

export interface ScorecardDispute {
  readonly raisedBy: UserId;
  readonly raisedAt: IsoDateTime;
  readonly reason: string;
  readonly resolvedAt?: IsoDateTime;
  readonly resolvedBy?: UserId;
  readonly resolution?: string;
}

export interface ScorecardProps {
  supplierId: Ulid;
  supplierCode: string;
  periodCode: string;
  periodKind: string;
  periodStart: DateOnly;
  periodEnd: DateOnly;
  status: ScorecardStatus;
  measurements: ScorecardMeasurement[];
  improvementActions: ImprovementAction[];
  dispute?: ScorecardDispute;
  score?: number;
  rating?: SupplierRating;
  previousScore?: number;
  publishedAt?: IsoDateTime;
  publishedBy?: UserId;
  publishedOn?: DateOnly;
  closedAt?: IsoDateTime;
  reviewNote?: string;
}

export interface OpenScorecardInput {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly period: PerformancePeriod;
  readonly previousScore?: number;
}

export interface RecordMeasurementInput {
  readonly kpiCode: string;
  readonly kpiName: string;
  readonly value: number;
  readonly score: number;
  readonly band: KpiBand;
  readonly weight: number;
  readonly target: number;
  readonly unit: string;
  readonly mandatory: boolean;
  readonly source: string;
  readonly note?: string;
}

export class Scorecard extends AggregateRoot<ScorecardProps> {
  static open(tenantId: TenantId, input: OpenScorecardInput): Scorecard {
    const scorecard = new Scorecard(tenantId, {
      supplierId: input.supplierId,
      supplierCode: input.supplierCode,
      periodCode: input.period.code,
      periodKind: input.period.kind,
      periodStart: input.period.start,
      periodEnd: input.period.end,
      status: "draft",
      measurements: [],
      improvementActions: [],
      previousScore: input.previousScore,
    });
    scorecard.emit(SrmEventTypes.ScorecardOpened);
    return scorecard;
  }

  static fromSnapshot(snapshot: EntityProps & ScorecardProps): Scorecard {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new Scorecard(
      tenantId,
      {
        ...props,
        measurements: [...props.measurements],
        improvementActions: [...props.improvementActions],
      },
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
  get periodCode(): string {
    return this.props.periodCode;
  }
  get periodStart(): DateOnly {
    return this.props.periodStart;
  }
  get periodEnd(): DateOnly {
    return this.props.periodEnd;
  }
  get status(): ScorecardStatus {
    return this.props.status;
  }
  get measurements(): readonly ScorecardMeasurement[] {
    return this.props.measurements;
  }
  get improvementActions(): readonly ImprovementAction[] {
    return this.props.improvementActions;
  }
  get dispute(): ScorecardDispute | undefined {
    return this.props.dispute;
  }
  get score(): number | undefined {
    return this.props.score;
  }
  get rating(): SupplierRating | undefined {
    return this.props.rating;
  }
  get previousScore(): number | undefined {
    return this.props.previousScore;
  }
  get publishedOn(): DateOnly | undefined {
    return this.props.publishedOn;
  }

  measurement(kpiCode: string): ScorecardMeasurement | undefined {
    return this.props.measurements.find((measurement) => measurement.kpiCode === kpiCode);
  }

  /** Provisional score before publication, using what has been measured. */
  currentScore(): number {
    return weightedAverage(this.props.measurements.map((m) => ({ weight: m.weight, score: m.score })));
  }

  redKpis(): readonly string[] {
    return this.props.measurements.filter((m) => m.band === "red").map((m) => m.kpiCode);
  }

  /** Score change against the previous period; undefined on a first rating. */
  delta(): number | undefined {
    if (this.props.score === undefined || this.props.previousScore === undefined) return undefined;
    return Math.round((this.props.score - this.props.previousScore) * 10) / 10;
  }

  openActions(): readonly ImprovementAction[] {
    return this.props.improvementActions.filter(
      (action) => action.status === "open" || action.status === "in_progress",
    );
  }

  overdueActions(asOf: DateOnly): readonly ImprovementAction[] {
    return this.openActions().filter((action) => compareDates(action.dueOn, asOf) < 0);
  }

  // --- measurement ---------------------------------------------------------

  recordMeasurement(input: RecordMeasurementInput, by: UserId, at: IsoDateTime): ScorecardMeasurement {
    if (this.props.status !== "draft" && this.props.status !== "in_review") {
      throw new InvalidStateError(
        `Scorecard ${this.props.supplierCode}/${this.props.periodCode} is ${this.props.status}; measurements are frozen`,
      );
    }
    if (input.weight <= 0) throw ValidationError.single("weight", "must be greater than 0");
    const measurement: ScorecardMeasurement = {
      kpiCode: input.kpiCode,
      kpiName: input.kpiName,
      value: input.value,
      score: input.score,
      band: input.band,
      weight: input.weight,
      target: input.target,
      unit: input.unit,
      mandatory: input.mandatory,
      source: input.source,
      recordedAt: at,
      recordedBy: by,
      note: input.note?.trim() || undefined,
      adjustments: [],
    };
    const index = this.props.measurements.findIndex((m) => m.kpiCode === input.kpiCode);
    if (index === -1) this.props.measurements.push(measurement);
    else this.props.measurements[index] = { ...measurement, adjustments: this.props.measurements[index]!.adjustments };
    this.emit(SrmEventTypes.ScorecardMeasurementRecorded, {
      kpiCode: measurement.kpiCode,
      value: measurement.value,
      score: measurement.score,
      band: measurement.band,
      source: measurement.source,
    });
    return measurement;
  }

  /** Moves the scorecard into the buyer/supplier review before publication. */
  submitForReview(note?: string): void {
    if (this.props.status !== "draft") {
      throw new InvalidStateError(`Scorecard ${this.props.periodCode} is ${this.props.status}, expected draft`);
    }
    if (this.props.measurements.length === 0) {
      throw new InvalidStateError(`Scorecard ${this.props.periodCode} has no measurements`);
    }
    this.props.status = "in_review";
    this.props.reviewNote = note?.trim() || undefined;
    this.touch();
  }

  /**
   * Publishes the period result. Mandatory KPIs are the contract with the
   * supplier: publishing without them would rate a supplier on a partial
   * picture, so it is rejected rather than silently reweighted.
   */
  publish(
    by: UserId,
    at: IsoDateTime,
    publishedOn: DateOnly,
    mandatoryKpiCodes: readonly string[],
  ): { readonly score: number; readonly rating: SupplierRating } {
    if (this.props.status !== "draft" && this.props.status !== "in_review") {
      throw new InvalidStateError(
        `Scorecard ${this.props.periodCode} is ${this.props.status}; only a draft or in-review scorecard can be published`,
      );
    }
    const missing = mandatoryKpiCodes.filter((code) => !this.measurement(code));
    if (missing.length > 0) {
      throw new InvalidStateError(
        `Scorecard ${this.props.periodCode} is missing mandatory KPIs: ${missing.join(", ")}`,
        { missing },
      );
    }
    const score = this.currentScore();
    const rating = ratingForScore(score);
    this.props.score = score;
    this.props.rating = rating;
    this.props.status = "published";
    this.props.publishedAt = at;
    this.props.publishedBy = by;
    this.props.publishedOn = publishedOn;
    this.emit(SrmEventTypes.ScorecardPublished, {
      score,
      rating,
      previousScore: this.props.previousScore,
      delta: this.delta(),
      kpiCount: this.props.measurements.length,
      redKpis: this.redKpis(),
      publishedBy: by,
    });
    if (requiresImprovementPlan(rating)) {
      this.emit(SrmEventTypes.ScorecardImprovementRequired, {
        score,
        rating,
        redKpis: this.redKpis(),
      });
    }
    return { score, rating };
  }

  // --- dispute -------------------------------------------------------------

  raiseDispute(
    by: UserId,
    reason: string,
    at: IsoDateTime,
    asOf: DateOnly,
    windowDays = DEFAULT_DISPUTE_WINDOW_DAYS,
  ): void {
    if (this.props.status !== "published") {
      throw new InvalidStateError(`Scorecard ${this.props.periodCode} is ${this.props.status}; nothing to dispute`);
    }
    const publishedOn = this.props.publishedOn;
    if (publishedOn && daysBetween(publishedOn, asOf) > windowDays) {
      throw new InvalidStateError(
        `The ${windowDays}-day dispute window for ${this.props.periodCode} closed on ${publishedOn}`,
      );
    }
    this.props.status = "disputed";
    this.props.dispute = { raisedBy: by, raisedAt: at, reason: nonEmpty(reason, "reason", 1000) };
    this.emit(SrmEventTypes.ScorecardDisputed, { raisedBy: by, reason: this.props.dispute.reason });
  }

  /**
   * Resolves a dispute, optionally correcting measurements. Corrections keep
   * the original value and the reason, and the score/rating are recomputed
   * from the corrected set.
   */
  resolveDispute(
    by: UserId,
    at: IsoDateTime,
    resolution: string,
    adjustments: readonly {
      kpiCode: string;
      value: number;
      score: number;
      band: KpiBand;
      reason: string;
    }[] = [],
  ): { readonly score: number; readonly rating: SupplierRating } {
    if (this.props.status !== "disputed") {
      throw new InvalidStateError(`Scorecard ${this.props.periodCode} is not disputed`);
    }
    for (const adjustment of adjustments) {
      const index = this.props.measurements.findIndex((m) => m.kpiCode === adjustment.kpiCode);
      if (index === -1) {
        throw new InvalidStateError(`KPI ${adjustment.kpiCode} was not measured on ${this.props.periodCode}`);
      }
      const current = this.props.measurements[index]!;
      this.props.measurements[index] = {
        ...current,
        value: adjustment.value,
        score: adjustment.score,
        band: adjustment.band,
        adjustments: [
          ...current.adjustments,
          {
            previousValue: current.value,
            previousScore: current.score,
            reason: nonEmpty(adjustment.reason, "reason", 500),
            adjustedAt: at,
            adjustedBy: by,
          },
        ],
      };
    }
    const score = this.currentScore();
    const rating = ratingForScore(score);
    this.props.score = score;
    this.props.rating = rating;
    this.props.status = "published";
    this.props.dispute = {
      ...this.props.dispute!,
      resolvedAt: at,
      resolvedBy: by,
      resolution: nonEmpty(resolution, "resolution", 1000),
    };
    this.emit(SrmEventTypes.ScorecardDisputeResolved, {
      score,
      rating,
      adjustments: adjustments.length,
      resolvedBy: by,
    });
    return { score, rating };
  }

  // --- improvement plan ----------------------------------------------------

  addImprovementAction(
    input: { title: string; ownerId: UserId; dueOn: DateOnly; kpiCode?: string },
    at: IsoDateTime,
  ): ImprovementAction {
    if (this.props.status === "closed") {
      throw new InvalidStateError(`Scorecard ${this.props.periodCode} is closed`);
    }
    if (input.kpiCode && !this.measurement(input.kpiCode)) {
      throw new InvalidStateError(`KPI ${input.kpiCode} was not measured on ${this.props.periodCode}`);
    }
    if (compareDates(input.dueOn, this.props.periodEnd) < 0) {
      throw ValidationError.single("dueOn", `must be on or after the period end ${this.props.periodEnd}`);
    }
    const action: ImprovementAction = {
      id: newId("action"),
      title: nonEmpty(input.title, "title", 300),
      kpiCode: input.kpiCode,
      ownerId: input.ownerId,
      dueOn: input.dueOn,
      status: "open",
      createdAt: at,
    };
    this.props.improvementActions.push(action);
    this.touch();
    return action;
  }

  completeAction(actionId: Ulid, at: IsoDateTime, outcome: string): ImprovementAction {
    const index = this.props.improvementActions.findIndex((action) => action.id === actionId);
    if (index === -1) {
      throw new InvalidStateError(`Action ${actionId} is not part of scorecard ${this.props.periodCode}`);
    }
    const action = this.props.improvementActions[index]!;
    if (action.status === "completed" || action.status === "cancelled") {
      throw new InvalidStateError(`Action ${actionId} is already ${action.status}`);
    }
    const updated: ImprovementAction = {
      ...action,
      status: "completed",
      completedAt: at,
      outcome: nonEmpty(outcome, "outcome", 1000),
    };
    this.props.improvementActions[index] = updated;
    this.emit(SrmEventTypes.ScorecardActionCompleted, { actionId, title: updated.title });
    return updated;
  }

  cancelAction(actionId: Ulid, reason: string): ImprovementAction {
    const index = this.props.improvementActions.findIndex((action) => action.id === actionId);
    if (index === -1) {
      throw new InvalidStateError(`Action ${actionId} is not part of scorecard ${this.props.periodCode}`);
    }
    const action = this.props.improvementActions[index]!;
    if (action.status === "completed") {
      throw new InvalidStateError(`Action ${actionId} is already completed`);
    }
    const updated: ImprovementAction = {
      ...action,
      status: "cancelled",
      outcome: nonEmpty(reason, "reason", 500),
    };
    this.props.improvementActions[index] = updated;
    this.touch();
    return updated;
  }

  /**
   * Closes the period. A watch/probation rating must have an improvement plan
   * and every action resolved, otherwise "we'll fix it" quietly expires with
   * the quarter.
   */
  close(at: IsoDateTime): void {
    if (this.props.status !== "published") {
      throw new InvalidStateError(
        `Scorecard ${this.props.periodCode} is ${this.props.status}; only a published scorecard can be closed`,
      );
    }
    const rating = this.props.rating ?? "probation";
    if (requiresImprovementPlan(rating)) {
      if (this.props.improvementActions.length === 0) {
        throw new InvalidStateError(
          `Scorecard ${this.props.periodCode} is rated ${rating} and needs an improvement plan before closing`,
        );
      }
      const open = this.openActions();
      if (open.length > 0) {
        throw new InvalidStateError(
          `Scorecard ${this.props.periodCode} still has ${open.length} open improvement action(s)`,
          { open: open.map((action) => action.id) },
        );
      }
    }
    this.props.status = "closed";
    this.props.closedAt = at;
    this.emit(SrmEventTypes.ScorecardClosed, { score: this.props.score, rating });
  }

  private emit(eventType: string, extra: Record<string, unknown> = {}): void {
    this.raise(
      envelope({
        eventType,
        aggregateType: "Scorecard",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          scorecardId: this.id,
          supplierId: this.props.supplierId,
          supplierCode: this.props.supplierCode,
          periodCode: this.props.periodCode,
          status: this.props.status,
          ...extra,
        },
      }),
    );
  }
}

/** Convenience for read models: band a raw score with the default thresholds. */
export function defaultBand(score: number): KpiBand {
  return bandForScore(score, 85, 70);
}

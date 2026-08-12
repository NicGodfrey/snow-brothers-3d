import {
  AggregateRoot,
  DomainError,
  type EntityProps,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import type { Lead, LeadActivityType, LeadGrade } from "./lead.js";
import { LEAD_ACTIVITY_TYPES } from "./lead.js";

/** Points awarded each time a lead performs the activity. */
export interface ActivityWeight {
  readonly activity: LeadActivityType;
  readonly points: number;
}

export type DemographicField = "industry" | "country" | "jobTitle" | "companySize" | "source";

export type DemographicOp = "eq" | "in" | "contains" | "gte" | "lte";

/**
 * Fit scoring on firmographic/demographic attributes. Value semantics depend
 * on the operator: `in` takes an array, `gte`/`lte` a number, others a string.
 */
export interface DemographicRule {
  readonly field: DemographicField;
  readonly op: DemographicOp;
  readonly value: string | number | readonly string[];
  readonly points: number;
}

export interface ScoringModelProps {
  name: string;
  activityWeights: ActivityWeight[];
  demographicRules: DemographicRule[];
  /** Exponential decay half-life for activity recency, in days. */
  halfLifeDays: number;
  /** Score at or above which a lead is marketing-qualified. */
  mqlThreshold: number;
  /** Score at or above which a lead is sales-qualified (with an MQL stage in between). */
  sqlThreshold: number;
  isDefault: boolean;
}

export interface ScoreBreakdown {
  readonly activityPoints: number;
  readonly demographicPoints: number;
  readonly total: number;
  readonly grade: LeadGrade;
  readonly perActivity: readonly { activity: LeadActivityType; rawPoints: number; decayedPoints: number }[];
  readonly matchedDemographicRules: readonly DemographicRule[];
}

const MS_PER_DAY = 86_400_000;

export function gradeForScore(score: number): LeadGrade {
  if (score >= 80) return "A";
  if (score >= 55) return "B";
  if (score >= 30) return "C";
  return "D";
}

export class ScoringModel extends AggregateRoot<ScoringModelProps> {
  private constructor(tenantId: TenantId, props: ScoringModelProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    name: string;
    activityWeights: ActivityWeight[];
    demographicRules?: DemographicRule[];
    halfLifeDays?: number;
    mqlThreshold?: number;
    sqlThreshold?: number;
    isDefault?: boolean;
  }): ScoringModel {
    const halfLifeDays = input.halfLifeDays ?? 14;
    const mqlThreshold = input.mqlThreshold ?? 40;
    const sqlThreshold = input.sqlThreshold ?? 70;
    if (halfLifeDays <= 0) {
      throw new DomainError("halfLifeDays must be positive", "SCORING_INVALID_HALF_LIFE");
    }
    if (mqlThreshold >= sqlThreshold) {
      throw new DomainError(
        "mqlThreshold must be below sqlThreshold",
        "SCORING_INVALID_THRESHOLDS",
      );
    }
    for (const w of input.activityWeights) {
      if (!(LEAD_ACTIVITY_TYPES as readonly string[]).includes(w.activity)) {
        throw new DomainError(`Unknown activity in weights: ${w.activity}`, "SCORING_INVALID_ACTIVITY");
      }
      if (w.points < 0) {
        throw new DomainError("Activity points cannot be negative", "SCORING_INVALID_POINTS");
      }
    }
    return new ScoringModel(input.tenantId, {
      name: input.name,
      activityWeights: [...input.activityWeights],
      demographicRules: [...(input.demographicRules ?? [])],
      halfLifeDays,
      mqlThreshold,
      sqlThreshold,
      isDefault: input.isDefault ?? false,
    });
  }

  get name(): string {
    return this.props.name;
  }

  get mqlThreshold(): number {
    return this.props.mqlThreshold;
  }

  get sqlThreshold(): number {
    return this.props.sqlThreshold;
  }

  get halfLifeDays(): number {
    return this.props.halfLifeDays;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  markDefault(): void {
    this.props.isDefault = true;
    this.touch();
  }

  updateThresholds(mqlThreshold: number, sqlThreshold: number): void {
    if (mqlThreshold >= sqlThreshold) {
      throw new DomainError("mqlThreshold must be below sqlThreshold", "SCORING_INVALID_THRESHOLDS");
    }
    this.props.mqlThreshold = mqlThreshold;
    this.props.sqlThreshold = sqlThreshold;
    this.touch();
  }

  replaceRules(activityWeights: ActivityWeight[], demographicRules: DemographicRule[]): void {
    this.props.activityWeights = [...activityWeights];
    this.props.demographicRules = [...demographicRules];
    this.touch();
  }

  private weightFor(activity: LeadActivityType): number {
    return this.props.activityWeights.find((w) => w.activity === activity)?.points ?? 0;
  }

  private demographicMatches(lead: Lead, rule: DemographicRule): boolean {
    const view = lead.view();
    const raw: string | number | undefined =
      rule.field === "companySize" ? view.companySize : view[rule.field];
    if (raw === undefined) return false;
    switch (rule.op) {
      case "eq":
        return String(raw).toLowerCase() === String(rule.value).toLowerCase();
      case "in":
        return (
          Array.isArray(rule.value) &&
          rule.value.some((v) => String(v).toLowerCase() === String(raw).toLowerCase())
        );
      case "contains":
        return String(raw).toLowerCase().includes(String(rule.value).toLowerCase());
      case "gte":
        return typeof raw === "number" && raw >= Number(rule.value);
      case "lte":
        return typeof raw === "number" && raw <= Number(rule.value);
      default:
        return false;
    }
  }

  /**
   * Computes a lead's score at instant `now`:
   *
   *   activityPoints = Σ points(activity) * 0.5^(ageDays / halfLifeDays)
   *   demographicPoints = Σ points of matching demographic rules (no decay)
   *   total = round(min(100, activityPoints + demographicPoints))
   *
   * Decay ensures a burst of activity six months ago does not keep a lead
   * hot forever, while firmographic fit is stable.
   */
  computeScore(lead: Lead, now: Date): ScoreBreakdown {
    const perActivity: { activity: LeadActivityType; rawPoints: number; decayedPoints: number }[] =
      [];
    let activityPoints = 0;
    for (const activity of lead.activities) {
      const rawPoints = this.weightFor(activity.type);
      if (rawPoints === 0) continue;
      const ageDays = Math.max(0, (now.getTime() - Date.parse(activity.occurredAt)) / MS_PER_DAY);
      const decayedPoints = rawPoints * Math.pow(0.5, ageDays / this.props.halfLifeDays);
      perActivity.push({ activity: activity.type, rawPoints, decayedPoints });
      activityPoints += decayedPoints;
    }

    const matchedDemographicRules = this.props.demographicRules.filter((rule) =>
      this.demographicMatches(lead, rule),
    );
    const demographicPoints = matchedDemographicRules.reduce((sum, r) => sum + r.points, 0);

    const total = Math.round(Math.min(100, activityPoints + demographicPoints));
    return {
      activityPoints,
      demographicPoints,
      total,
      grade: gradeForScore(total),
      perActivity,
      matchedDemographicRules,
    };
  }

  /** Which funnel stage the score alone justifies. */
  stageSuggestion(score: number): "none" | "mql" | "sql" {
    if (score >= this.props.sqlThreshold) return "sql";
    if (score >= this.props.mqlThreshold) return "mql";
    return "none";
  }
}

/** A sensible starter model applied when a tenant has not configured one. */
export function defaultScoringModel(tenantId: TenantId): ScoringModel {
  return ScoringModel.create({
    tenantId,
    name: "Default B2B model",
    isDefault: true,
    activityWeights: [
      { activity: "page_view", points: 1 },
      { activity: "form_submit", points: 10 },
      { activity: "email_open", points: 2 },
      { activity: "email_click", points: 5 },
      { activity: "sms_click", points: 5 },
      { activity: "webinar_attend", points: 15 },
      { activity: "event_checkin", points: 15 },
      { activity: "content_download", points: 8 },
      { activity: "pricing_view", points: 12 },
      { activity: "demo_request", points: 30 },
      { activity: "trial_signup", points: 35 },
    ],
    demographicRules: [
      { field: "jobTitle", op: "contains", value: "vp", points: 10 },
      { field: "jobTitle", op: "contains", value: "director", points: 8 },
      { field: "jobTitle", op: "contains", value: "head of", points: 8 },
      { field: "companySize", op: "gte", value: 200, points: 10 },
      { field: "industry", op: "in", value: ["saas", "fintech", "manufacturing"], points: 6 },
    ],
    halfLifeDays: 14,
    mqlThreshold: 40,
    sqlThreshold: 70,
  });
}

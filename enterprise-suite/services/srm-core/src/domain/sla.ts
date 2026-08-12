import { money, type Money, type Ulid } from "@enterprise-suite/shared-kernel";
import type { DateOnly } from "./dates.js";
import { ValidationError } from "./errors.js";
import type { KpiDirection } from "./kpi.js";

/**
 * Service-level commitments attached to a contract, and the arithmetic that
 * turns a measured period into a breach and a service credit.
 *
 * The evaluation is deliberately a pure function: the same rules run when a
 * scorecard is published (automatic evaluation from measured KPIs), when a
 * buyer records a manual measurement, and in tests. Severity comes from *how
 * far* the measurement missed the target relative to the tolerance band, not
 * from a hand-picked label, and the credit is capped per period so a single
 * catastrophic month cannot exceed the negotiated liability.
 */

export type SlaMetric =
  | "on_time_delivery"
  | "fill_rate"
  | "quality_ppm"
  | "first_pass_yield"
  | "response_time_hours"
  | "resolution_time_hours"
  | "uptime_percent"
  | "lead_time_days";

export const SLA_METRICS: readonly SlaMetric[] = [
  "on_time_delivery",
  "fill_rate",
  "quality_ppm",
  "first_pass_yield",
  "response_time_hours",
  "resolution_time_hours",
  "uptime_percent",
  "lead_time_days",
];

export interface SlaMetricSpec {
  readonly unit: string;
  readonly direction: KpiDirection;
  /** KPI code whose scorecard measurement can feed this metric automatically. */
  readonly kpiCode?: string;
}

export const SLA_METRIC_SPECS: Readonly<Record<SlaMetric, SlaMetricSpec>> = {
  on_time_delivery: { unit: "percent", direction: "higher_better", kpiCode: "on-time-delivery" },
  fill_rate: { unit: "percent", direction: "higher_better", kpiCode: "fill-rate" },
  quality_ppm: { unit: "ppm", direction: "lower_better", kpiCode: "quality-ppm" },
  first_pass_yield: { unit: "percent", direction: "higher_better" },
  response_time_hours: { unit: "hours", direction: "lower_better", kpiCode: "responsiveness-hours" },
  resolution_time_hours: { unit: "hours", direction: "lower_better" },
  uptime_percent: { unit: "percent", direction: "higher_better" },
  lead_time_days: { unit: "days", direction: "lower_better" },
};

export function isSlaMetric(value: string): value is SlaMetric {
  return (SLA_METRICS as readonly string[]).includes(value);
}

export type MeasurementWindow = "monthly" | "quarterly" | "annual";

export const MEASUREMENT_WINDOWS: readonly MeasurementWindow[] = ["monthly", "quarterly", "annual"];

export type BreachSeverity = "minor" | "major" | "severe";

export const BREACH_SEVERITIES: readonly BreachSeverity[] = ["minor", "major", "severe"];

/** Credit multiplier applied to the base rate, by severity. */
export const SEVERITY_MULTIPLIER: Readonly<Record<BreachSeverity, number>> = {
  minor: 1,
  major: 2,
  severe: 3,
};

export type PenaltyModel =
  | { readonly kind: "none" }
  | { readonly kind: "service_credit_percent"; readonly percent: number }
  | { readonly kind: "fixed_credit"; readonly amountMinor: number; readonly currency: string };

export interface SlaEscalation {
  /** Breaches inside the rolling window that trigger this level. */
  readonly afterBreaches: number;
  readonly action: string;
}

export interface SlaCommitment {
  readonly id: Ulid;
  readonly metric: SlaMetric;
  readonly description?: string;
  readonly target: number;
  readonly unit: string;
  readonly direction: KpiDirection;
  /** Deviation from target tolerated before a breach is recorded. */
  readonly tolerance: number;
  readonly window: MeasurementWindow;
  /** Breaches forgiven per rolling 12 months before credits start. */
  readonly graceBreaches: number;
  readonly penalty: PenaltyModel;
  /** Hard cap on credits per period, as a percentage of period spend. */
  readonly creditCapPercent: number;
  readonly escalations: readonly SlaEscalation[];
  readonly effectiveFrom: DateOnly;
  readonly isActive: boolean;
}

export type BreachStatus = "open" | "acknowledged" | "credited" | "waived" | "disputed";

export interface SlaBreach {
  readonly id: Ulid;
  readonly commitmentId: Ulid;
  readonly metric: SlaMetric;
  readonly periodCode: string;
  readonly target: number;
  readonly measured: number;
  readonly deviation: number;
  readonly severity: BreachSeverity;
  readonly status: BreachStatus;
  readonly credit?: Money;
  readonly recordedOn: DateOnly;
  readonly consecutive: number;
  readonly escalation?: string;
  readonly note?: string;
  readonly resolvedOn?: DateOnly;
}

export interface SlaEvaluation {
  readonly breached: boolean;
  /** Signed shortfall against target in the metric's own unit. */
  readonly deviation: number;
  /** Shortfall as a share of the tolerance band (1 = exactly at tolerance). */
  readonly toleranceRatio: number;
  readonly severity: BreachSeverity;
  readonly credit?: Money;
}

export function assertCommitmentShape(input: {
  target: number;
  tolerance: number;
  graceBreaches: number;
  creditCapPercent: number;
  penalty: PenaltyModel;
}): void {
  if (!Number.isFinite(input.target)) throw ValidationError.single("target", "must be a finite number");
  if (!Number.isFinite(input.tolerance) || input.tolerance < 0) {
    throw ValidationError.single("tolerance", "must be zero or a positive number");
  }
  if (!Number.isInteger(input.graceBreaches) || input.graceBreaches < 0 || input.graceBreaches > 12) {
    throw ValidationError.single("graceBreaches", "must be an integer between 0 and 12");
  }
  if (!Number.isFinite(input.creditCapPercent) || input.creditCapPercent < 0 || input.creditCapPercent > 100) {
    throw ValidationError.single("creditCapPercent", "must be between 0 and 100");
  }
  if (input.penalty.kind === "service_credit_percent") {
    if (!Number.isFinite(input.penalty.percent) || input.penalty.percent <= 0 || input.penalty.percent > 100) {
      throw ValidationError.single("penalty.percent", "must be greater than 0 and at most 100");
    }
  }
  if (input.penalty.kind === "fixed_credit" && !Number.isInteger(input.penalty.amountMinor)) {
    throw ValidationError.single("penalty.amountMinor", "must be an integer amount in minor units");
  }
}

/** Signed miss against the target, in the metric's unit (0 when met). */
export function deviationFromTarget(
  direction: KpiDirection,
  target: number,
  measured: number,
): number {
  const raw = direction === "higher_better" ? target - measured : measured - target;
  return raw <= 0 ? 0 : Math.round(raw * 1000) / 1000;
}

export function severityFor(deviation: number, tolerance: number): BreachSeverity {
  // Without a tolerance band, grade against the miss itself.
  const band = tolerance > 0 ? tolerance : 1;
  const ratio = deviation / band;
  if (ratio <= 2) return "minor";
  if (ratio <= 4) return "major";
  return "severe";
}

/**
 * Evaluates one measurement against a commitment.
 *
 * `periodSpend` is the spend the credit is calculated on; without it a
 * percentage credit cannot be quantified and only the breach is reported.
 * `priorBreaches` counts breaches already recorded in the rolling window, so
 * the grace allowance is consumed before any credit accrues.
 */
export function evaluateSla(
  commitment: Pick<
    SlaCommitment,
    "direction" | "target" | "tolerance" | "penalty" | "creditCapPercent" | "graceBreaches"
  >,
  measured: number,
  options: { readonly periodSpend?: Money; readonly priorBreaches?: number } = {},
): SlaEvaluation {
  if (!Number.isFinite(measured)) {
    throw ValidationError.single("measured", "must be a finite number");
  }
  const deviation = deviationFromTarget(commitment.direction, commitment.target, measured);
  const breached = deviation > commitment.tolerance;
  const severity = severityFor(deviation, commitment.tolerance);
  const toleranceRatio =
    commitment.tolerance > 0 ? Math.round((deviation / commitment.tolerance) * 100) / 100 : deviation > 0 ? 1 : 0;
  if (!breached) {
    return { breached: false, deviation, toleranceRatio, severity: "minor" };
  }

  const priorBreaches = options.priorBreaches ?? 0;
  if (priorBreaches < commitment.graceBreaches) {
    // Inside the grace allowance: the breach is recorded, no credit accrues.
    return { breached: true, deviation, toleranceRatio, severity };
  }

  const credit = computeCredit(commitment, severity, options.periodSpend);
  return { breached: true, deviation, toleranceRatio, severity, credit };
}

function computeCredit(
  commitment: Pick<SlaCommitment, "penalty" | "creditCapPercent">,
  severity: BreachSeverity,
  periodSpend?: Money,
): Money | undefined {
  const penalty = commitment.penalty;
  if (penalty.kind === "none") return undefined;
  if (penalty.kind === "fixed_credit") {
    return money(penalty.amountMinor * SEVERITY_MULTIPLIER[severity], penalty.currency);
  }
  if (!periodSpend) return undefined;
  const rate = (penalty.percent / 100) * SEVERITY_MULTIPLIER[severity];
  const uncapped = Math.round(periodSpend.amountMinor * rate);
  const cap = Math.round(periodSpend.amountMinor * (commitment.creditCapPercent / 100));
  return money(Math.min(uncapped, cap), periodSpend.currency);
}

/** The escalation level triggered by the n-th breach, if any. */
export function escalationFor(
  escalations: readonly SlaEscalation[],
  breachCount: number,
): SlaEscalation | undefined {
  return [...escalations]
    .filter((escalation) => breachCount >= escalation.afterBreaches)
    .sort((a, b) => b.afterBreaches - a.afterBreaches)[0];
}

import type { IsoDateTime, TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import { ValidationError } from "./errors.js";

/**
 * KPI definitions and the raw-value → score function behind every scorecard.
 *
 * A KPI is measured in its own unit (percent, PPM, days, currency) and can be
 * "higher is better" (on-time delivery) or "lower is better" (defect PPM,
 * price variance). To make heterogeneous KPIs addable, each definition
 * declares a **floor** (the value scoring 0) and a **target** (the value
 * scoring 100) and the raw measurement is linearly interpolated between them.
 * That keeps the scoring explainable — a buyer can point at "97% against a 98%
 * target and a 90% floor" and see where the 87.5 came from.
 */

export type KpiCategory = "quality" | "delivery" | "cost" | "service" | "innovation" | "esg" | "compliance";

export const KPI_CATEGORIES: readonly KpiCategory[] = [
  "quality",
  "delivery",
  "cost",
  "service",
  "innovation",
  "esg",
  "compliance",
];

export type KpiUnit = "percent" | "ppm" | "days" | "hours" | "count" | "currency" | "score" | "ratio";

export const KPI_UNITS: readonly KpiUnit[] = [
  "percent",
  "ppm",
  "days",
  "hours",
  "count",
  "currency",
  "score",
  "ratio",
];

export type KpiDirection = "higher_better" | "lower_better";

export type KpiBand = "green" | "amber" | "red";

export type KpiSource = "system" | "manual" | "survey" | "supplier_reported";

export const KPI_SOURCES: readonly KpiSource[] = ["system", "manual", "survey", "supplier_reported"];

export interface KpiDefinitionRecord {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  /** Stable slug used as the measurement key ("on-time-delivery"). */
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly category: KpiCategory;
  readonly unit: KpiUnit;
  readonly direction: KpiDirection;
  /** Value that scores 100. */
  readonly target: number;
  /** Value that scores 0; on the far side of `target` from perfection. */
  readonly floor: number;
  /** Relative weight inside the scorecard (any positive number). */
  readonly weight: number;
  /** Mandatory KPIs must be measured before a scorecard can be published. */
  readonly mandatory: boolean;
  readonly source: KpiSource;
  /** Score at or above which the KPI is green / amber. */
  readonly greenScore: number;
  readonly amberScore: number;
  readonly isActive: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface KpiScore {
  readonly score: number;
  readonly band: KpiBand;
}

export function assertKpiBounds(definition: {
  direction: KpiDirection;
  target: number;
  floor: number;
  weight: number;
  greenScore: number;
  amberScore: number;
}): void {
  if (!Number.isFinite(definition.target) || !Number.isFinite(definition.floor)) {
    throw ValidationError.single("target", "target and floor must be finite numbers");
  }
  if (definition.target === definition.floor) {
    throw ValidationError.single("floor", "floor must differ from target");
  }
  if (definition.direction === "higher_better" && definition.floor > definition.target) {
    throw ValidationError.single("floor", "for higher_better KPIs the floor must be below the target");
  }
  if (definition.direction === "lower_better" && definition.floor < definition.target) {
    throw ValidationError.single("floor", "for lower_better KPIs the floor must be above the target");
  }
  if (!Number.isFinite(definition.weight) || definition.weight <= 0 || definition.weight > 100) {
    throw ValidationError.single("weight", "must be greater than 0 and at most 100");
  }
  if (definition.amberScore > definition.greenScore) {
    throw ValidationError.single("amberScore", "must not exceed greenScore");
  }
  for (const [field, value] of [
    ["greenScore", definition.greenScore],
    ["amberScore", definition.amberScore],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw ValidationError.single(field, "must be between 0 and 100");
    }
  }
}

/** Linear interpolation between floor (0) and target (100), clamped. */
export function scoreKpi(
  definition: Pick<
    KpiDefinitionRecord,
    "direction" | "target" | "floor" | "greenScore" | "amberScore"
  >,
  value: number,
): KpiScore {
  if (!Number.isFinite(value)) {
    throw ValidationError.single("value", "must be a finite number");
  }
  const span = definition.target - definition.floor;
  const raw = ((value - definition.floor) / span) * 100;
  const score = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;
  return { score, band: bandForScore(score, definition.greenScore, definition.amberScore) };
}

export function bandForScore(score: number, greenScore: number, amberScore: number): KpiBand {
  if (score >= greenScore) return "green";
  if (score >= amberScore) return "amber";
  return "red";
}

export interface WeightedMeasurement {
  readonly weight: number;
  readonly score: number;
}

/** Weighted mean of the measured KPIs, rounded to one decimal. */
export function weightedAverage(measurements: readonly WeightedMeasurement[]): number {
  const totalWeight = measurements.reduce((sum, measurement) => sum + measurement.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = measurements.reduce((sum, m) => sum + m.weight * m.score, 0);
  return Math.round((weighted / totalWeight) * 10) / 10;
}

export interface StandardKpi {
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly category: KpiCategory;
  readonly unit: KpiUnit;
  readonly direction: KpiDirection;
  readonly target: number;
  readonly floor: number;
  readonly weight: number;
  readonly mandatory: boolean;
  readonly source: KpiSource;
}

/** Catalog seeded into a new tenant; each is editable afterwards. */
export const STANDARD_KPIS: readonly StandardKpi[] = [
  {
    code: "on-time-delivery",
    name: "On-time delivery",
    description: "Receipts inside the promised delivery window, as a share of all receipts.",
    category: "delivery",
    unit: "percent",
    direction: "higher_better",
    target: 98,
    floor: 85,
    weight: 25,
    mandatory: true,
    source: "system",
  },
  {
    code: "quality-ppm",
    name: "Defect rate",
    description: "Rejected parts per million received.",
    category: "quality",
    unit: "ppm",
    direction: "lower_better",
    target: 500,
    floor: 10_000,
    weight: 25,
    mandatory: true,
    source: "system",
  },
  {
    code: "ncr-closure-days",
    name: "NCR closure time",
    description: "Average calendar days to close a non-conformance report.",
    category: "quality",
    unit: "days",
    direction: "lower_better",
    target: 10,
    floor: 45,
    weight: 10,
    mandatory: false,
    source: "system",
  },
  {
    code: "price-variance",
    name: "Purchase price variance",
    description: "Invoiced price against the contracted price, as a percentage.",
    category: "cost",
    unit: "percent",
    direction: "lower_better",
    target: 0,
    floor: 8,
    weight: 15,
    mandatory: true,
    source: "system",
  },
  {
    code: "responsiveness-hours",
    name: "RFQ responsiveness",
    description: "Average hours to respond to a request for quotation.",
    category: "service",
    unit: "hours",
    direction: "lower_better",
    target: 24,
    floor: 120,
    weight: 10,
    mandatory: false,
    source: "system",
  },
  {
    code: "fill-rate",
    name: "Order fill rate",
    description: "Ordered quantity delivered complete on the first shipment.",
    category: "delivery",
    unit: "percent",
    direction: "higher_better",
    target: 99,
    floor: 90,
    weight: 10,
    mandatory: false,
    source: "system",
  },
  {
    code: "invoice-accuracy",
    name: "Invoice accuracy",
    description: "Invoices matching the PO and receipt without manual correction.",
    category: "compliance",
    unit: "percent",
    direction: "higher_better",
    target: 99,
    floor: 90,
    weight: 5,
    mandatory: false,
    source: "system",
  },
  {
    code: "esg-rating",
    name: "ESG rating",
    description: "Third-party sustainability score (0-100).",
    category: "esg",
    unit: "score",
    direction: "higher_better",
    target: 70,
    floor: 30,
    weight: 5,
    mandatory: false,
    source: "survey",
  },
  {
    code: "cost-savings",
    name: "Cost-improvement contribution",
    description: "Validated year-on-year savings delivered against the agreed target.",
    category: "cost",
    unit: "percent",
    direction: "higher_better",
    target: 3,
    floor: 0,
    weight: 5,
    mandatory: false,
    source: "manual",
  },
  {
    code: "innovation-proposals",
    name: "Innovation proposals",
    description: "Qualified improvement proposals submitted in the period.",
    category: "innovation",
    unit: "count",
    direction: "higher_better",
    target: 4,
    floor: 0,
    weight: 5,
    mandatory: false,
    source: "manual",
  },
];

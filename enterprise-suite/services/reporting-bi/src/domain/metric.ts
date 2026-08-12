/**
 * Metric definitions — the semantic layer.
 *
 * A metric is the single authoritative answer to "what does net revenue
 * mean?". Two kinds exist:
 *
 *  - **base**: an aggregation over one numeric field of a fact table
 *    (`sum(net_amount_minor)`, `count_distinct(customer_id)`).
 *  - **derived**: an expression over other metrics of the same cube,
 *    evaluated *after* aggregation. This ordering is the whole point: the
 *    average order value of a month is `sum(revenue) / count(orders)`, not
 *    the average of per-order ratios.
 *
 * Definitions are versioned by a lifecycle (draft → published → deprecated)
 * so dashboards can pin to published metrics while analysts iterate on
 * drafts in the same catalog.
 */
import {
  AggregateRoot,
  ConflictError,
  envelope,
  type EntityProps,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { DefinitionError } from "./errors.js";
import { ReportingEventTypes } from "./events.js";
import { parseExpression, referencedNames, type Expression } from "./expression.js";

export type Aggregation =
  | "sum"
  | "avg"
  | "min"
  | "max"
  | "count"
  | "count_distinct"
  | "first"
  | "last";

export const AGGREGATIONS: readonly Aggregation[] = [
  "sum",
  "avg",
  "min",
  "max",
  "count",
  "count_distinct",
  "first",
  "last",
];

/**
 * How a metric value should be read. `currency` values are integer minor
 * units end-to-end (shared-kernel Money convention) and only become decimal
 * at the formatting boundary.
 */
export type MetricUnit =
  | "count"
  | "currency"
  | "quantity"
  | "ratio"
  | "percent"
  | "days"
  | "seconds";

export const METRIC_UNITS: readonly MetricUnit[] = [
  "count",
  "currency",
  "quantity",
  "ratio",
  "percent",
  "days",
  "seconds",
];

/** Which way is "good" — drives KPI status colouring and variance signs. */
export type MetricDirection = "higher-is-better" | "lower-is-better" | "neutral";

export type MetricStatus = "draft" | "published" | "deprecated";

export type MetricKind = "base" | "derived";

const CODE_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export function assertMetricCode(code: string): string {
  if (!CODE_PATTERN.test(code)) {
    throw new DefinitionError(
      `metric code '${code}' must be snake_case, start with a letter, and be 2..64 characters`,
    );
  }
  return code;
}

interface MetricProps {
  code: string;
  name: string;
  description?: string;
  cube: string;
  kind: MetricKind;
  unit: MetricUnit;
  direction: MetricDirection;
  status: MetricStatus;
  decimals: number;
  /** base only: aggregation applied to `sourceField` */
  aggregation?: Aggregation;
  /**
   * base only: the fact measure field to aggregate. For `count_distinct`
   * this names a *dimension* key instead (distinct customers, not distinct
   * amounts); `count` needs no field at all.
   */
  sourceField?: string;
  /** derived only: expression over sibling metric codes */
  expression?: string;
  tags: string[];
}

export interface DefineMetricInput {
  code: string;
  name: string;
  cube: string;
  unit: MetricUnit;
  description?: string;
  direction?: MetricDirection;
  decimals?: number;
  aggregation?: Aggregation;
  sourceField?: string;
  expression?: string;
  tags?: readonly string[];
}

export class MetricDefinition extends AggregateRoot<MetricProps> {
  private compiled?: Expression;

  private constructor(tenantId: TenantId, props: MetricProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static define(tenantId: TenantId, input: DefineMetricInput): MetricDefinition {
    const code = assertMetricCode(input.code);
    if (!input.name.trim()) throw new DefinitionError("metric name is required");
    if (!input.cube.trim()) throw new DefinitionError("metric must belong to a cube");

    const kind: MetricKind = input.expression ? "derived" : "base";
    if (kind === "base") {
      validateBase(code, input.aggregation, input.sourceField);
    } else if (input.aggregation || input.sourceField) {
      throw new DefinitionError(
        `derived metric '${code}' must not declare an aggregation or sourceField`,
      );
    }

    const decimals = input.decimals ?? defaultDecimals(input.unit);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
      throw new DefinitionError(`metric '${code}' decimals must be an integer 0..6`);
    }

    const metric = new MetricDefinition(tenantId, {
      code,
      name: input.name.trim(),
      description: input.description?.trim(),
      cube: input.cube,
      kind,
      unit: input.unit,
      direction: input.direction ?? "higher-is-better",
      status: "draft",
      decimals,
      aggregation: kind === "base" ? (input.aggregation ?? "sum") : undefined,
      sourceField: input.sourceField,
      expression: input.expression?.trim(),
      tags: [...(input.tags ?? [])],
    });
    // Parse eagerly so a malformed expression is rejected at definition time
    // rather than at 3am when a dashboard refreshes.
    if (kind === "derived") metric.ast();

    metric.raise(
      envelope({
        eventType: ReportingEventTypes.MetricDefined,
        aggregateType: "MetricDefinition",
        aggregateId: metric.id,
        tenantId,
        payload: {
          code,
          cube: input.cube,
          kind,
          unit: input.unit,
          aggregation: metric.props.aggregation,
          expression: metric.props.expression,
        },
      }),
    );
    return metric;
  }

  static rehydrate(
    tenantId: TenantId,
    props: MetricProps,
    existing: Partial<EntityProps>,
  ): MetricDefinition {
    return new MetricDefinition(tenantId, props, existing);
  }

  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get description(): string | undefined { return this.props.description; }
  get cube(): string { return this.props.cube; }
  get kind(): MetricKind { return this.props.kind; }
  get unit(): MetricUnit { return this.props.unit; }
  get direction(): MetricDirection { return this.props.direction; }
  get status(): MetricStatus { return this.props.status; }
  get decimals(): number { return this.props.decimals; }
  get aggregation(): Aggregation | undefined { return this.props.aggregation; }
  get sourceField(): string | undefined { return this.props.sourceField; }
  get expression(): string | undefined { return this.props.expression; }
  get tags(): readonly string[] { return this.props.tags; }

  /** Parsed expression for derived metrics (cached per aggregate instance). */
  ast(): Expression {
    if (this.props.kind !== "derived" || !this.props.expression) {
      throw new ConflictError(`metric '${this.props.code}' is not a derived metric`);
    }
    this.compiled ??= parseExpression(this.props.expression);
    return this.compiled;
  }

  /** Metric codes this metric needs before it can be evaluated. */
  dependencies(): readonly string[] {
    return this.props.kind === "derived" ? referencedNames(this.ast()) : [];
  }

  redefine(input: {
    name?: string;
    description?: string;
    unit?: MetricUnit;
    direction?: MetricDirection;
    decimals?: number;
    aggregation?: Aggregation;
    sourceField?: string;
    expression?: string;
    tags?: readonly string[];
  }): void {
    if (this.props.status === "deprecated") {
      throw new ConflictError(`metric '${this.props.code}' is deprecated and cannot be edited`);
    }
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new DefinitionError("metric name cannot be blank");
      this.props.name = input.name.trim();
    }
    if (input.description !== undefined) this.props.description = input.description.trim();
    if (input.unit !== undefined) this.props.unit = input.unit;
    if (input.direction !== undefined) this.props.direction = input.direction;
    if (input.decimals !== undefined) {
      if (!Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 6) {
        throw new DefinitionError("decimals must be an integer 0..6");
      }
      this.props.decimals = input.decimals;
    }
    if (input.expression !== undefined) {
      if (this.props.kind !== "derived") {
        throw new DefinitionError(
          `metric '${this.props.code}' is a base metric; expressions are not applicable`,
        );
      }
      this.props.expression = input.expression.trim();
      this.compiled = undefined;
      this.ast();
    }
    if (input.aggregation !== undefined || input.sourceField !== undefined) {
      if (this.props.kind !== "base") {
        throw new DefinitionError(
          `metric '${this.props.code}' is derived; aggregation/sourceField are not applicable`,
        );
      }
      const aggregation = input.aggregation ?? this.props.aggregation;
      const sourceField = input.sourceField ?? this.props.sourceField;
      validateBase(this.props.code, aggregation, sourceField);
      this.props.aggregation = aggregation;
      this.props.sourceField = sourceField;
    }
    if (input.tags !== undefined) this.props.tags = [...input.tags];

    this.raise(
      envelope({
        eventType: ReportingEventTypes.MetricUpdated,
        aggregateType: "MetricDefinition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, cube: this.props.cube },
      }),
    );
  }

  publish(): void {
    if (this.props.status === "published") {
      throw new ConflictError(`metric '${this.props.code}' is already published`);
    }
    this.props.status = "published";
    this.raise(
      envelope({
        eventType: ReportingEventTypes.MetricPublished,
        aggregateType: "MetricDefinition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, cube: this.props.cube, kind: this.props.kind },
      }),
    );
  }

  deprecate(reason: string): void {
    if (!reason.trim()) throw new DefinitionError("a deprecation reason is required");
    if (this.props.status === "deprecated") {
      throw new ConflictError(`metric '${this.props.code}' is already deprecated`);
    }
    this.props.status = "deprecated";
    this.raise(
      envelope({
        eventType: ReportingEventTypes.MetricDeprecated,
        aggregateType: "MetricDefinition",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { code: this.props.code, cube: this.props.cube, reason: reason.trim() },
      }),
    );
  }
}

function validateBase(code: string, aggregation?: Aggregation, sourceField?: string): void {
  const agg = aggregation ?? "sum";
  if (!AGGREGATIONS.includes(agg)) {
    throw new DefinitionError(`metric '${code}' has unknown aggregation '${agg}'`);
  }
  if (agg !== "count" && !sourceField) {
    throw new DefinitionError(`metric '${code}' uses ${agg} and therefore needs a sourceField`);
  }
  if (agg === "count" && sourceField) {
    throw new DefinitionError(
      `metric '${code}' uses count over whole rows; drop sourceField or use count_distinct`,
    );
  }
}

function defaultDecimals(unit: MetricUnit): number {
  switch (unit) {
    case "count":
      return 0;
    case "currency":
      return 2;
    case "ratio":
      return 4;
    case "percent":
      return 2;
    case "quantity":
      return 3;
    case "days":
      return 1;
    case "seconds":
      return 0;
  }
}

/**
 * Orders metrics so every derived metric comes after everything it reads,
 * rejecting cycles. Derived metrics may build on other derived metrics
 * (`margin_pct` on `gross_profit` on `revenue - cogs`), so a plain
 * two-pass "base then derived" split is not enough.
 */
export function resolveEvaluationOrder(
  metrics: readonly MetricDefinition[],
): readonly MetricDefinition[] {
  const byCode = new Map(metrics.map((m) => [m.code, m]));
  const ordered: MetricDefinition[] = [];
  const state = new Map<string, "visiting" | "done">();

  const visit = (metric: MetricDefinition, path: readonly string[]): void => {
    const current = state.get(metric.code);
    if (current === "done") return;
    if (current === "visiting") {
      throw new DefinitionError(
        `metric dependency cycle: ${[...path, metric.code].join(" -> ")}`,
      );
    }
    state.set(metric.code, "visiting");
    for (const dependency of metric.dependencies()) {
      const target = byCode.get(dependency);
      if (!target) {
        throw new DefinitionError(
          `metric '${metric.code}' references unknown metric '${dependency}'`,
        );
      }
      if (target.cube !== metric.cube) {
        throw new DefinitionError(
          `metric '${metric.code}' (cube ${metric.cube}) cannot reference '${dependency}' from cube ${target.cube}`,
        );
      }
      visit(target, [...path, metric.code]);
    }
    state.set(metric.code, "done");
    ordered.push(metric);
  };

  for (const metric of metrics) visit(metric, []);
  return ordered;
}

/** Presentation helper shared by CSV export and dashboard rendering. */
export function formatMetricValue(
  metric: Pick<MetricDefinition, "unit" | "decimals">,
  value: number | null,
): string {
  if (value === null) return "";
  switch (metric.unit) {
    case "currency":
      return (value / 100).toFixed(metric.decimals);
    case "percent":
      return `${value.toFixed(metric.decimals)}%`;
    default:
      return value.toFixed(metric.decimals);
  }
}

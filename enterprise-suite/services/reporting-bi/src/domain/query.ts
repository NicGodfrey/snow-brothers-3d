/**
 * The cube query model.
 *
 * A query is a declarative request — "these metrics, by these dimensions,
 * over this window" — with no reference to storage. The same object is what
 * the HTTP API accepts, what dashboard tiles embed, and what export jobs
 * serialize, so a tile can always be turned into a CSV of exactly what the
 * user saw.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import { QueryError } from "./errors.js";
import { isTimeGrain, type ComparisonMode, type TimeGrain, type TimeRange } from "./time-grain.js";

/** Synthetic dimension key produced when a query requests a time grain. */
export const PERIOD_KEY = "period";

export const MAX_ROWS = 5_000;
export const DEFAULT_LIMIT = 500;

export type FilterOperator =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "contains"
  | "starts_with"
  | "exists"
  | "missing";

export const FILTER_OPERATORS: readonly FilterOperator[] = [
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "exists",
  "missing",
];

export interface DimensionFilter {
  /** Dimension reference: `warehouse` or `product.category`. */
  readonly dimension: string;
  readonly op: FilterOperator;
  readonly value?: string;
  readonly values?: readonly string[];
}

export type HavingOperator = "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | "between";

export const HAVING_OPERATORS: readonly HavingOperator[] = [
  "gt",
  "gte",
  "lt",
  "lte",
  "eq",
  "neq",
  "between",
];

/** Post-aggregation filter on a metric value (SQL HAVING). */
export interface MetricFilter {
  readonly metric: string;
  readonly op: HavingOperator;
  readonly value: number;
  /** Upper bound for `between` (inclusive). */
  readonly upper?: number;
}

export interface OrderBy {
  /** A metric code, a dimension reference, or `period`. */
  readonly key: string;
  readonly direction: "asc" | "desc";
}

/** Keep the N biggest groups and fold the rest into one "Other" row. */
export interface TopN {
  readonly metric: string;
  readonly limit: number;
  readonly includeOther: boolean;
  readonly otherLabel: string;
}

export interface CubeQuery {
  readonly cube: string;
  readonly metrics: readonly string[];
  readonly dimensions: readonly string[];
  readonly timeGrain?: TimeGrain;
  readonly timeRange?: TimeRange;
  readonly filters: readonly DimensionFilter[];
  readonly having: readonly MetricFilter[];
  readonly orderBy: readonly OrderBy[];
  readonly limit: number;
  readonly offset: number;
  readonly topN?: TopN;
  readonly compareTo?: ComparisonMode;
  /** Emit rows for empty periods inside the range (dense time series). */
  readonly densify: boolean;
  readonly includeTotals: boolean;
}

export interface CubeQueryInput {
  cube: string;
  metrics: readonly string[];
  dimensions?: readonly string[];
  timeGrain?: string;
  timeRange?: TimeRange;
  filters?: readonly DimensionFilter[];
  having?: readonly MetricFilter[];
  orderBy?: readonly OrderBy[];
  limit?: number;
  offset?: number;
  topN?: { metric: string; limit: number; includeOther?: boolean; otherLabel?: string };
  compareTo?: string;
  densify?: boolean;
  includeTotals?: boolean;
}

/**
 * Validates the *shape* of a query — everything checkable without the
 * catalog. Catalog checks (does this metric exist on this cube?) happen in
 * the query service, which is where the repositories live.
 */
export function normalizeQuery(input: CubeQueryInput): CubeQuery {
  if (!input.cube?.trim()) throw new QueryError("query requires a cube");
  if (!input.metrics || input.metrics.length === 0) {
    throw new QueryError("query requires at least one metric");
  }
  const metrics = dedupe(input.metrics);
  const dimensions = dedupe(input.dimensions ?? []);
  if (dimensions.includes(PERIOD_KEY)) {
    throw new QueryError(`'${PERIOD_KEY}' is reserved; request it with timeGrain instead`);
  }

  if (input.timeGrain !== undefined && !isTimeGrain(input.timeGrain)) {
    throw new QueryError(`unknown time grain '${input.timeGrain}'`);
  }
  const timeGrain = input.timeGrain as TimeGrain | undefined;

  if (input.compareTo !== undefined && input.compareTo !== "previous-period" && input.compareTo !== "previous-year") {
    throw new QueryError(`unknown comparison '${input.compareTo}'`);
  }
  const compareTo = input.compareTo as ComparisonMode | undefined;
  if (compareTo && !input.timeRange) {
    throw new QueryError("comparisons need an explicit timeRange to shift");
  }
  if (compareTo === "previous-period" && !timeGrain) {
    throw new QueryError("previous-period comparison needs a timeGrain to measure the shift");
  }

  for (const filter of input.filters ?? []) {
    if (!filter.dimension?.trim()) throw new QueryError("filter requires a dimension");
    if (!FILTER_OPERATORS.includes(filter.op)) {
      throw new QueryError(`unknown filter operator '${filter.op}'`);
    }
    if ((filter.op === "in" || filter.op === "not_in") && (!filter.values || filter.values.length === 0)) {
      throw new QueryError(`filter on '${filter.dimension}' with '${filter.op}' needs a non-empty values array`);
    }
    if (
      (filter.op === "eq" || filter.op === "neq" || filter.op === "contains" || filter.op === "starts_with") &&
      (filter.value === undefined || filter.value === null)
    ) {
      throw new QueryError(`filter on '${filter.dimension}' with '${filter.op}' needs a value`);
    }
  }

  for (const having of input.having ?? []) {
    if (!metrics.includes(having.metric)) {
      throw new QueryError(
        `having clause references '${having.metric}', which is not one of the selected metrics`,
      );
    }
    if (!HAVING_OPERATORS.includes(having.op)) {
      throw new QueryError(`unknown having operator '${having.op}'`);
    }
    if (typeof having.value !== "number" || !Number.isFinite(having.value)) {
      throw new QueryError(`having clause on '${having.metric}' needs a finite value`);
    }
    if (having.op === "between" && (typeof having.upper !== "number" || having.upper < having.value)) {
      throw new QueryError(`'between' on '${having.metric}' needs an upper bound >= value`);
    }
  }

  const groupKeys = new Set<string>([...dimensions, ...(timeGrain ? [PERIOD_KEY] : [])]);
  for (const order of input.orderBy ?? []) {
    if (!groupKeys.has(order.key) && !metrics.includes(order.key)) {
      throw new QueryError(
        `orderBy '${order.key}' must be a selected metric or a grouping key (${[...groupKeys].join(", ") || "none"})`,
      );
    }
    if (order.direction !== "asc" && order.direction !== "desc") {
      throw new QueryError(`orderBy '${order.key}' has invalid direction '${order.direction}'`);
    }
  }

  let topN: TopN | undefined;
  if (input.topN) {
    if (!metrics.includes(input.topN.metric)) {
      throw new QueryError(`topN ranks by '${input.topN.metric}', which is not a selected metric`);
    }
    if (!Number.isInteger(input.topN.limit) || input.topN.limit < 1) {
      throw new QueryError("topN limit must be a positive integer");
    }
    if (dimensions.length === 0) {
      throw new QueryError("topN needs at least one dimension to rank");
    }
    topN = {
      metric: input.topN.metric,
      limit: input.topN.limit,
      includeOther: input.topN.includeOther ?? true,
      otherLabel: input.topN.otherLabel ?? "Other",
    };
  }

  const limit = clampLimit(input.limit);
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0) {
    throw new QueryError("offset must be a non-negative integer");
  }
  if (input.densify && !timeGrain) {
    throw new QueryError("densify requires a timeGrain");
  }
  if (input.densify && !input.timeRange) {
    throw new QueryError("densify requires a timeRange to know which periods to fill");
  }

  return {
    cube: input.cube,
    metrics,
    dimensions,
    timeGrain,
    timeRange: input.timeRange,
    filters: [...(input.filters ?? [])],
    having: [...(input.having ?? [])],
    orderBy: [...(input.orderBy ?? [])],
    limit,
    offset,
    topN,
    compareTo,
    densify: input.densify ?? false,
    includeTotals: input.includeTotals ?? true,
  };
}

function clampLimit(limit?: number): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new QueryError("limit must be a positive integer");
  }
  return Math.min(limit, MAX_ROWS);
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

/** All grouping keys of a query, period first when a grain is requested. */
export function groupingKeys(query: CubeQuery): string[] {
  return query.timeGrain ? [PERIOD_KEY, ...query.dimensions] : [...query.dimensions];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export interface QueryColumn {
  readonly key: string;
  readonly label: string;
  readonly kind: "dimension" | "metric" | "time";
  readonly unit?: string;
}

export interface QueryRow {
  /** Raw member keys, one per grouping key. */
  readonly keys: Readonly<Record<string, string>>;
  /** Display labels resolved through the dimension catalog. */
  readonly labels: Readonly<Record<string, string>>;
  readonly metrics: Readonly<Record<string, number | null>>;
  /** Same metrics over the comparison window, when one was requested. */
  readonly comparison?: Readonly<Record<string, number | null>>;
  readonly delta?: Readonly<Record<string, number | null>>;
  readonly deltaPct?: Readonly<Record<string, number | null>>;
}

export interface CubeQueryResult {
  readonly cube: string;
  readonly generatedAt: IsoDateTime;
  readonly grain?: TimeGrain;
  readonly columns: readonly QueryColumn[];
  readonly rows: readonly QueryRow[];
  readonly totals: Readonly<Record<string, number | null>>;
  readonly rowCount: number;
  /** Groups formed before limit/offset — how much the client is not seeing. */
  readonly groupCount: number;
  readonly factsScanned: number;
  readonly truncated: boolean;
  readonly comparison?: {
    readonly mode: ComparisonMode;
    readonly range: TimeRange;
  };
}

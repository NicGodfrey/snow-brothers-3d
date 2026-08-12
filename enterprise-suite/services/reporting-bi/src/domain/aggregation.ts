/**
 * The aggregation engine: facts in, a result table out.
 *
 * Execution order matters and mirrors SQL:
 *
 *   1. WHERE      time range + dimension filters (rollups resolved first)
 *   2. GROUP BY   period bucket + requested dimension levels
 *   3. aggregate  one accumulator per base metric per group
 *   4. derive     expression metrics, evaluated on aggregated values
 *   5. HAVING     filters on metric results
 *   6. ORDER/TOP  ranking, "Other" folding, densification
 *   7. LIMIT      paging, with the pre-limit group count reported back
 *
 * Step 4 sitting after step 3 is the reason derived metrics exist as their
 * own kind: the margin of a month is computed from the month's totals, not
 * averaged from per-transaction margins.
 *
 * This is an in-memory engine over a fact array. The interfaces are the same
 * ones a SQL-backed implementation would need, so swapping the store later
 * means replacing `selectFacts`/`groupFacts` with generated SQL, not
 * rewriting the semantic layer.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { CubeDefinition } from "./cube.js";
import { parseDimensionRef, type Dimension } from "./dimension.js";
import { QueryError } from "./errors.js";
import { evaluate, scopeOf, type MetricValue } from "./expression.js";
import { UNKNOWN_MEMBER, type FactRecord } from "./fact.js";
import { resolveEvaluationOrder, type MetricDefinition } from "./metric.js";
import {
  groupingKeys,
  MAX_ROWS,
  PERIOD_KEY,
  type CubeQuery,
  type CubeQueryResult,
  type DimensionFilter,
  type MetricFilter,
  type QueryColumn,
  type QueryRow,
} from "./query.js";
import {
  addPeriods,
  bucketStart,
  comparisonRange,
  countPeriods,
  enumeratePeriods,
  inRange,
  periodKey,
  periodLabel,
  periodStart,
  type TimeGrain,
} from "./time-grain.js";

/** Label used for groups whose member key cannot be rolled up. */
export const OTHER_KEY = "__other__";

export interface AggregationContext {
  readonly cube: CubeDefinition;
  /** Every metric the query needs, including transitive dependencies. */
  readonly metrics: readonly MetricDefinition[];
  readonly dimensions: ReadonlyMap<string, Dimension>;
  readonly now: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Accumulators
// ---------------------------------------------------------------------------

interface Accumulator {
  add(fact: FactRecord): void;
  value(): MetricValue;
}

class SumAccumulator implements Accumulator {
  private total = 0;
  private seen = 0;
  constructor(private readonly field: string) {}
  add(fact: FactRecord): void {
    const value = fact.measures[this.field];
    if (typeof value === "number") {
      this.total += value;
      this.seen += 1;
    }
  }
  value(): MetricValue {
    return this.seen === 0 ? null : this.total;
  }
}

class AvgAccumulator implements Accumulator {
  private total = 0;
  private seen = 0;
  constructor(private readonly field: string) {}
  add(fact: FactRecord): void {
    const value = fact.measures[this.field];
    if (typeof value === "number") {
      this.total += value;
      this.seen += 1;
    }
  }
  value(): MetricValue {
    return this.seen === 0 ? null : this.total / this.seen;
  }
}

class ExtremumAccumulator implements Accumulator {
  private current: number | null = null;
  constructor(private readonly field: string, private readonly mode: "min" | "max") {}
  add(fact: FactRecord): void {
    const value = fact.measures[this.field];
    if (typeof value !== "number") return;
    if (this.current === null) this.current = value;
    else this.current = this.mode === "min" ? Math.min(this.current, value) : Math.max(this.current, value);
  }
  value(): MetricValue {
    return this.current;
  }
}

class CountAccumulator implements Accumulator {
  private count = 0;
  add(): void {
    this.count += 1;
  }
  value(): MetricValue {
    return this.count;
  }
}

/**
 * Distinct count over a *dimension* value (distinct customers, distinct
 * SKUs). Falls back to the measure map so a numeric id column still works.
 */
class DistinctAccumulator implements Accumulator {
  private readonly seen = new Set<string>();
  constructor(private readonly field: string) {}
  add(fact: FactRecord): void {
    const dimensionValue = fact.dimensions[this.field];
    if (typeof dimensionValue === "string") {
      if (dimensionValue !== UNKNOWN_MEMBER) this.seen.add(dimensionValue);
      return;
    }
    const measureValue = fact.measures[this.field];
    if (typeof measureValue === "number") this.seen.add(String(measureValue));
  }
  value(): MetricValue {
    return this.seen.size;
  }
}

/** Value of the chronologically first/last contributing fact. */
class EdgeAccumulator implements Accumulator {
  private current: number | null = null;
  private currentAt: string | null = null;
  constructor(private readonly field: string, private readonly mode: "first" | "last") {}
  add(fact: FactRecord): void {
    const value = fact.measures[this.field];
    if (typeof value !== "number") return;
    if (
      this.currentAt === null ||
      (this.mode === "last" ? fact.occurredAt >= this.currentAt : fact.occurredAt < this.currentAt)
    ) {
      this.current = value;
      this.currentAt = fact.occurredAt;
    }
  }
  value(): MetricValue {
    return this.current;
  }
}

function createAccumulator(metric: MetricDefinition): Accumulator {
  const field = metric.sourceField ?? "";
  switch (metric.aggregation) {
    case "sum":
      return new SumAccumulator(field);
    case "avg":
      return new AvgAccumulator(field);
    case "min":
      return new ExtremumAccumulator(field, "min");
    case "max":
      return new ExtremumAccumulator(field, "max");
    case "count":
      return new CountAccumulator();
    case "count_distinct":
      return new DistinctAccumulator(field);
    case "first":
      return new EdgeAccumulator(field, "first");
    case "last":
      return new EdgeAccumulator(field, "last");
    default:
      throw new QueryError(`metric '${metric.code}' has no aggregation to apply`);
  }
}

// ---------------------------------------------------------------------------
// Dimension resolution
// ---------------------------------------------------------------------------

interface ResolvedRef {
  /** As written in the query, e.g. "product.category". */
  readonly ref: string;
  readonly factKey: string;
  readonly levelKey?: string;
  readonly dimension?: Dimension;
  readonly label: string;
}

function resolveRef(ref: string, ctx: AggregationContext): ResolvedRef {
  const parsed = parseDimensionRef(ref);
  const binding = ctx.cube.binding(parsed.dimensionKey);
  if (!binding) {
    throw new QueryError(
      `cube '${ctx.cube.name}' has no dimension '${parsed.dimensionKey}' (available: ${ctx.cube.dimensions
        .map((d) => d.factKey)
        .join(", ")})`,
    );
  }
  const dimension = ctx.dimensions.get(binding.dimensionKey);
  if (parsed.levelKey) {
    if (!dimension) {
      throw new QueryError(
        `dimension '${binding.dimensionKey}' is not registered, so level '${parsed.levelKey}' cannot be resolved`,
      );
    }
    if (!dimension.hasLevel(parsed.levelKey)) {
      throw new QueryError(
        `dimension '${binding.dimensionKey}' has no level '${parsed.levelKey}' (levels: ${dimension.levels
          .map((l) => l.key)
          .join(", ")})`,
      );
    }
  }
  const levelLabel =
    parsed.levelKey && dimension ? dimension.level(parsed.levelKey)?.label : undefined;
  return {
    ref,
    factKey: binding.factKey,
    levelKey: parsed.levelKey,
    dimension,
    label: levelLabel ? `${binding.label} / ${levelLabel}` : binding.label,
  };
}

/** The member key a fact contributes to for one resolved reference. */
function valueFor(fact: FactRecord, resolved: ResolvedRef): string {
  const raw = fact.dimensions[resolved.factKey] ?? UNKNOWN_MEMBER;
  if (!resolved.levelKey || !resolved.dimension) return raw;
  if (resolved.dimension.leafLevel.key === resolved.levelKey) return raw;
  return resolved.dimension.rollUp(raw, resolved.levelKey) ?? UNKNOWN_MEMBER;
}

function labelFor(resolved: ResolvedRef, memberKey: string): string {
  if (memberKey === OTHER_KEY) return "Other";
  return resolved.dimension?.labelFor(memberKey) ?? memberKey;
}

function matchesFilter(value: string, filter: DimensionFilter): boolean {
  switch (filter.op) {
    case "eq":
      return value === filter.value;
    case "neq":
      return value !== filter.value;
    case "in":
      return (filter.values ?? []).includes(value);
    case "not_in":
      return !(filter.values ?? []).includes(value);
    case "contains":
      return value.toLowerCase().includes((filter.value ?? "").toLowerCase());
    case "starts_with":
      return value.toLowerCase().startsWith((filter.value ?? "").toLowerCase());
    case "exists":
      return value !== UNKNOWN_MEMBER;
    case "missing":
      return value === UNKNOWN_MEMBER;
  }
}

function matchesHaving(value: MetricValue, having: MetricFilter): boolean {
  if (value === null) return false;
  switch (having.op) {
    case "gt":
      return value > having.value;
    case "gte":
      return value >= having.value;
    case "lt":
      return value < having.value;
    case "lte":
      return value <= having.value;
    case "eq":
      return value === having.value;
    case "neq":
      return value !== having.value;
    case "between":
      return value >= having.value && value <= (having.upper ?? having.value);
  }
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

const GROUP_SEPARATOR = "\u0001";

interface GroupState {
  readonly keys: Record<string, string>;
  readonly accumulators: Map<string, Accumulator>;
  factCount: number;
}

interface Grouping {
  readonly groups: Map<string, GroupState>;
  readonly total: GroupState;
  readonly factsScanned: number;
}

function newGroupState(keys: Record<string, string>, baseMetrics: readonly MetricDefinition[]): GroupState {
  return {
    keys,
    accumulators: new Map(baseMetrics.map((metric) => [metric.code, createAccumulator(metric)])),
    factCount: 0,
  };
}

function aggregate(
  facts: readonly FactRecord[],
  query: CubeQuery,
  ctx: AggregationContext,
  refs: readonly ResolvedRef[],
  range?: { from: IsoDateTime; toExclusive: IsoDateTime },
): Grouping {
  const baseMetrics = ctx.metrics.filter((m) => m.kind === "base");
  const filterRefs = query.filters.map((filter) => ({
    filter,
    resolved: resolveRef(filter.dimension, ctx),
  }));

  const groups = new Map<string, GroupState>();
  const total = newGroupState({}, baseMetrics);
  let factsScanned = 0;

  for (const fact of facts) {
    if (fact.cube !== ctx.cube.name) continue;
    if (range && !inRange(fact.occurredAt, range)) continue;
    let excluded = false;
    for (const { filter, resolved } of filterRefs) {
      if (!matchesFilter(valueFor(fact, resolved), filter)) {
        excluded = true;
        break;
      }
    }
    if (excluded) continue;

    factsScanned += 1;
    total.accumulators.forEach((accumulator) => accumulator.add(fact));
    total.factCount += 1;

    const keys: Record<string, string> = {};
    if (query.timeGrain) {
      keys[PERIOD_KEY] = periodKey(bucketStart(fact.occurredAt, query.timeGrain), query.timeGrain);
    }
    for (const ref of refs) keys[ref.ref] = valueFor(fact, ref);

    const identity = groupingKeys(query)
      .map((key) => keys[key] ?? "")
      .join(GROUP_SEPARATOR);
    let group = groups.get(identity);
    if (!group) {
      group = newGroupState(keys, baseMetrics);
      groups.set(identity, group);
    }
    group.accumulators.forEach((accumulator) => accumulator.add(fact));
    group.factCount += 1;
  }

  return { groups, total, factsScanned };
}

/** Aggregated base values plus every derived metric, in dependency order. */
function finalize(
  state: GroupState | null,
  query: CubeQuery,
  ordered: readonly MetricDefinition[],
): Record<string, MetricValue> {
  const values: Record<string, MetricValue> = {};
  for (const metric of ordered) {
    if (metric.kind === "base") {
      const accumulator = state?.accumulators.get(metric.code);
      values[metric.code] = accumulator
        ? accumulator.value()
        : metric.aggregation === "count" || metric.aggregation === "count_distinct"
          ? 0
          : null;
      continue;
    }
    values[metric.code] = evaluate(metric.ast(), scopeOf(values));
  }
  // Dependencies were needed for evaluation but were not asked for.
  const selected: Record<string, MetricValue> = {};
  for (const code of query.metrics) selected[code] = values[code] ?? null;
  return selected;
}

// ---------------------------------------------------------------------------
// Query execution
// ---------------------------------------------------------------------------

export function executeQuery(
  facts: readonly FactRecord[],
  query: CubeQuery,
  ctx: AggregationContext,
): CubeQueryResult {
  const ordered = resolveEvaluationOrder(ctx.metrics);
  const refs = query.dimensions.map((ref) => resolveRef(ref, ctx));

  const primary = aggregate(facts, query, ctx, refs, query.timeRange);

  let comparisonGroups: Map<string, Record<string, MetricValue>> | undefined;
  let comparisonMeta: CubeQueryResult["comparison"];
  if (query.compareTo && query.timeRange) {
    const shifted = comparisonRange(query.timeRange, query.timeGrain ?? "day", query.compareTo);
    const compared = aggregate(facts, query, ctx, refs, shifted);
    comparisonGroups = new Map();
    const shiftUnits =
      query.compareTo === "previous-year" ? 1 : countPeriods(query.timeRange, query.timeGrain ?? "day");
    const shiftGrain: TimeGrain = query.compareTo === "previous-year" ? "year" : (query.timeGrain ?? "day");
    for (const state of compared.groups.values()) {
      const aligned = { ...state.keys };
      if (query.timeGrain && aligned[PERIOD_KEY]) {
        aligned[PERIOD_KEY] = shiftPeriodKey(aligned[PERIOD_KEY], query.timeGrain, shiftGrain, shiftUnits);
      }
      const identity = groupingKeys(query)
        .map((key) => aligned[key] ?? "")
        .join(GROUP_SEPARATOR);
      comparisonGroups.set(identity, finalize(state, query, ordered));
    }
    comparisonMeta = { mode: query.compareTo, range: shifted };
  }

  let rows: MutableRow[] = [...primary.groups.entries()].map(([identity, state]) => ({
    identity,
    keys: state.keys,
    metrics: finalize(state, query, ordered),
  }));

  if (query.having.length > 0) {
    rows = rows.filter((row) => query.having.every((clause) => matchesHaving(row.metrics[clause.metric] ?? null, clause)));
  }

  if (query.topN) rows = applyTopN(rows, query, refs, ordered);
  if (query.densify && query.timeRange && query.timeGrain) {
    rows = densify(rows, query, ordered);
  }

  sortRows(rows, query);

  const groupCount = rows.length;
  const paged = rows.slice(query.offset, query.offset + query.limit);

  const columns = buildColumns(query, refs, ctx);
  const resultRows: QueryRow[] = paged.map((row) => {
    const labels: Record<string, string> = {};
    if (query.timeGrain && row.keys[PERIOD_KEY]) {
      labels[PERIOD_KEY] = periodLabel(row.keys[PERIOD_KEY], query.timeGrain);
    }
    for (const ref of refs) labels[ref.ref] = labelFor(ref, row.keys[ref.ref] ?? UNKNOWN_MEMBER);

    if (!comparisonGroups) {
      return { keys: row.keys, labels, metrics: row.metrics };
    }
    const previous = comparisonGroups.get(row.identity);
    const comparison: Record<string, MetricValue> = {};
    const delta: Record<string, MetricValue> = {};
    const deltaPct: Record<string, MetricValue> = {};
    for (const code of query.metrics) {
      const current = row.metrics[code] ?? null;
      const before = previous?.[code] ?? null;
      comparison[code] = before;
      delta[code] = current === null || before === null ? null : current - before;
      deltaPct[code] =
        current === null || before === null || before === 0
          ? null
          : ((current - before) / Math.abs(before)) * 100;
    }
    return { keys: row.keys, labels, metrics: row.metrics, comparison, delta, deltaPct };
  });

  return {
    cube: ctx.cube.name,
    generatedAt: ctx.now,
    grain: query.timeGrain,
    columns,
    rows: resultRows,
    totals: query.includeTotals ? finalize(primary.total, query, ordered) : {},
    rowCount: resultRows.length,
    groupCount,
    factsScanned: primary.factsScanned,
    truncated: groupCount > query.offset + resultRows.length,
    comparison: comparisonMeta,
  };
}

interface MutableRow {
  identity: string;
  keys: Record<string, string>;
  metrics: Record<string, MetricValue>;
}

/**
 * Shifts a comparison period key forward so it lines up with the primary
 * window. Sub-month grains under a year-over-year comparison land on the
 * bucket containing the same calendar date one year later.
 */
function shiftPeriodKey(
  key: string,
  grain: TimeGrain,
  shiftGrain: TimeGrain,
  units: number,
): string {
  const start = periodStart(key, grain);
  return periodKey(bucketStart(addPeriods(start, shiftGrain, units), grain), grain);
}

/**
 * Keeps the top N groups by one metric. Everything else is folded into a
 * single "Other" row so the total still reconciles — a top-10 chart whose
 * slices do not add up to the headline number is worse than no chart.
 */
function applyTopN(
  rows: readonly MutableRow[],
  query: CubeQuery,
  refs: readonly ResolvedRef[],
  ordered: readonly MetricDefinition[],
): MutableRow[] {
  const topN = query.topN!;
  const ranked = [...rows].sort((a, b) => compareValues(b.metrics[topN.metric] ?? null, a.metrics[topN.metric] ?? null));
  const kept = ranked.slice(0, topN.limit);
  const rest = ranked.slice(topN.limit);
  if (rest.length === 0 || !topN.includeOther) return kept;

  // "Other" can only be summed for additive metrics; ratios of a residual
  // bucket are meaningless, so they come back null.
  const otherMetrics: Record<string, MetricValue> = {};
  for (const code of query.metrics) {
    const metric = ordered.find((m) => m.code === code);
    const additive = metric?.kind === "base" && (metric.aggregation === "sum" || metric.aggregation === "count");
    if (!additive) {
      otherMetrics[code] = null;
      continue;
    }
    let sum = 0;
    let seen = false;
    for (const row of rest) {
      const value = row.metrics[code];
      if (typeof value === "number") {
        sum += value;
        seen = true;
      }
    }
    otherMetrics[code] = seen ? sum : null;
  }

  const keys: Record<string, string> = {};
  if (query.timeGrain) keys[PERIOD_KEY] = OTHER_KEY;
  for (const ref of refs) keys[ref.ref] = OTHER_KEY;
  return [...kept, { identity: `${OTHER_KEY}${GROUP_SEPARATOR}${rest.length}`, keys, metrics: otherMetrics }];
}

/** Adds empty rows for periods with no facts so time series have no gaps. */
function densify(
  rows: readonly MutableRow[],
  query: CubeQuery,
  ordered: readonly MetricDefinition[],
): MutableRow[] {
  const grain = query.timeGrain!;
  const periods = enumeratePeriods(query.timeRange!, grain, MAX_ROWS);
  const combinations = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const withoutPeriod: Record<string, string> = { ...row.keys };
    delete withoutPeriod[PERIOD_KEY];
    combinations.set(
      query.dimensions.map((d) => withoutPeriod[d] ?? "").join(GROUP_SEPARATOR),
      withoutPeriod,
    );
  }
  if (combinations.size === 0) combinations.set("", {});

  const existing = new Set(rows.map((row) => row.identity));
  const filled: MutableRow[] = [...rows];
  const emptyMetrics = finalize(null, query, ordered);

  for (const combination of combinations.values()) {
    for (const period of periods) {
      const keys: Record<string, string> = { ...combination, [PERIOD_KEY]: period };
      const identity = groupingKeys(query)
        .map((key) => keys[key] ?? "")
        .join(GROUP_SEPARATOR);
      if (existing.has(identity)) continue;
      if (filled.length >= MAX_ROWS) return filled;
      filled.push({ identity, keys, metrics: { ...emptyMetrics } });
      existing.add(identity);
    }
  }
  return filled;
}

function sortRows(rows: MutableRow[], query: CubeQuery): void {
  const orderBy =
    query.orderBy.length > 0
      ? query.orderBy
      : query.timeGrain
        ? [{ key: PERIOD_KEY, direction: "asc" as const }]
        : [{ key: query.metrics[0]!, direction: "desc" as const }];

  rows.sort((a, b) => {
    for (const clause of orderBy) {
      const factor = clause.direction === "asc" ? 1 : -1;
      const isMetric = Object.prototype.hasOwnProperty.call(a.metrics, clause.key);
      const comparison = isMetric
        ? compareValues(a.metrics[clause.key] ?? null, b.metrics[clause.key] ?? null)
        : (a.keys[clause.key] ?? "").localeCompare(b.keys[clause.key] ?? "");
      if (comparison !== 0) return comparison * factor;
    }
    return a.identity.localeCompare(b.identity);
  });
}

/** Nulls sort last regardless of direction, matching NULLS LAST. */
function compareValues(a: MetricValue, b: MetricValue): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a === b ? 0 : a < b ? -1 : 1;
}

function buildColumns(
  query: CubeQuery,
  refs: readonly ResolvedRef[],
  ctx: AggregationContext,
): QueryColumn[] {
  const columns: QueryColumn[] = [];
  if (query.timeGrain) {
    columns.push({ key: PERIOD_KEY, label: "Period", kind: "time" });
  }
  for (const ref of refs) {
    columns.push({ key: ref.ref, label: ref.label, kind: "dimension" });
  }
  for (const code of query.metrics) {
    const metric = ctx.metrics.find((m) => m.code === code);
    columns.push({
      key: code,
      label: metric?.name ?? code,
      kind: "metric",
      unit: metric?.unit,
    });
  }
  return columns;
}

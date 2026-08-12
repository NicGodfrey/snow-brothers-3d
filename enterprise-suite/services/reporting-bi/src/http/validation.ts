/**
 * Request parsing.
 *
 * The split of responsibility is deliberate: this module only checks that
 * JSON has the *shape* the domain expects (types, enums, required keys) and
 * turns it into the domain's input objects. Semantic validation — does this
 * metric exist, is that expression acyclic, is the having clause over a
 * selected metric — belongs to the domain and stays there, so the same rules
 * apply whether a caller comes through HTTP, the seed, or a test.
 *
 * Every failure here throws a DomainError with code VALIDATION, which the
 * router renders as HTTP 400.
 */
import { brand, DomainError, type Ulid } from "@enterprise-suite/shared-kernel";
import { CHART_KINDS, type ChartKind, type TileType } from "../domain/dashboard.js";
import { DIMENSION_TYPES, type DimensionType } from "../domain/dimension.js";
import {
  EXPORT_FORMATS,
  EXPORT_KINDS,
  type ExportFormat,
  type ExportRequest,
  type ExportStatus,
} from "../domain/export-job.js";
import { AGGREGATIONS, METRIC_UNITS, type Aggregation, type MetricDirection, type MetricStatus, type MetricUnit } from "../domain/metric.js";
import {
  FILTER_OPERATORS,
  HAVING_OPERATORS,
  type CubeQueryInput,
  type DimensionFilter,
  type MetricFilter,
  type OrderBy,
} from "../domain/query.js";
import { TIME_GRAINS, timeRange, type TimeGrain } from "../domain/time-grain.js";

const DIRECTIONS = ["higher-is-better", "lower-is-better", "neutral"] as const;
const METRIC_STATUSES = ["draft", "published", "deprecated"] as const;
const CUBE_STATUSES = ["draft", "published", "archived"] as const;
const DASHBOARD_STATUSES = ["draft", "published", "archived"] as const;
const EXPORT_STATUSES = ["queued", "running", "completed", "failed", "cancelled"] as const;
const TILE_TYPES = ["kpi", "chart", "table"] as const;

function invalid(message: string, details?: unknown): DomainError {
  return new DomainError(message, "VALIDATION", 400, details);
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export function asObject(body: unknown, name = "body"): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw invalid(`${name} must be a JSON object`);
  }
  return body as Record<string, unknown>;
}

export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw invalid(`'${key}' is required and must be a non-empty string`);
  }
  return value;
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid(`'${key}' must be a string`);
  return value;
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`'${key}' is required and must be a finite number`);
  }
  return value;
}

export function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalid(`'${key}' must be a finite number`);
  }
  return value;
}

export function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw invalid(`'${key}' must be a boolean`);
  return value;
}

export function optionalEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = optionalString(obj, key);
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    throw invalid(`'${key}' must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

export function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = requireString(obj, key);
  if (!values.includes(value as T)) {
    throw invalid(`'${key}' must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

export function optionalStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalid(`'${key}' must be an array of strings`);
  }
  return value as string[];
}

export function requireStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = optionalStringArray(obj, key);
  if (!value || value.length === 0) {
    throw invalid(`'${key}' must be a non-empty array of strings`);
  }
  return value;
}

export function optionalObjectArray(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw invalid(`'${key}' must be an array of objects`);
  return value.map((item, index) => asObject(item, `${key}[${index}]`));
}

export function optionalStringRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, key);
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") throw invalid(`'${key}.${entryKey}' must be a string`);
  }
  return record as Record<string, string>;
}

export function ulidParam(params: Record<string, string>, key: string): Ulid {
  const value = params[key];
  if (!value) throw invalid(`missing path parameter '${key}'`);
  return brand<string, "Ulid">(value);
}

export function pathParam(params: Record<string, string>, key: string): string {
  const value = params[key];
  if (!value) throw invalid(`missing path parameter '${key}'`);
  return value;
}

// ---------------------------------------------------------------------------
// Query-string helpers
// ---------------------------------------------------------------------------

export function queryEnum<T extends string>(
  query: URLSearchParams,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  if (!values.includes(value as T)) {
    throw invalid(`query '${key}' must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

export function queryInt(query: URLSearchParams, key: string): number | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw invalid(`query '${key}' must be a non-negative integer`);
  }
  return parsed;
}

export function queryBoolean(query: URLSearchParams, key: string): boolean | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw invalid(`query '${key}' must be 'true' or 'false'`);
}

export function queryList(query: URLSearchParams, key: string): string[] | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function queryInstant(query: URLSearchParams, key: string) {
  const value = query.get(key);
  if (value === null) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw invalid(`query '${key}' must be an ISO-8601 instant`);
  }
  return brand<string, "IsoDateTime">(parsed.toISOString());
}

export const metricStatusValues = METRIC_STATUSES;
export const cubeStatusValues = CUBE_STATUSES;
export const dashboardStatusValues = DASHBOARD_STATUSES;
export const exportStatusValues: readonly ExportStatus[] = EXPORT_STATUSES;

// ---------------------------------------------------------------------------
// Catalog inputs
// ---------------------------------------------------------------------------

export function parseDefineMetric(body: unknown) {
  const obj = asObject(body);
  return {
    code: requireString(obj, "code"),
    name: requireString(obj, "name"),
    cube: requireString(obj, "cube"),
    unit: requireEnum<MetricUnit>(obj, "unit", METRIC_UNITS),
    description: optionalString(obj, "description"),
    direction: optionalEnum<MetricDirection>(obj, "direction", DIRECTIONS),
    decimals: optionalNumber(obj, "decimals"),
    aggregation: optionalEnum<Aggregation>(obj, "aggregation", AGGREGATIONS),
    sourceField: optionalString(obj, "sourceField"),
    expression: optionalString(obj, "expression"),
    tags: optionalStringArray(obj, "tags"),
  };
}

export function parseUpdateMetric(body: unknown) {
  const obj = asObject(body);
  return {
    name: optionalString(obj, "name"),
    description: optionalString(obj, "description"),
    unit: optionalEnum<MetricUnit>(obj, "unit", METRIC_UNITS),
    direction: optionalEnum<MetricDirection>(obj, "direction", DIRECTIONS),
    decimals: optionalNumber(obj, "decimals"),
    aggregation: optionalEnum<Aggregation>(obj, "aggregation", AGGREGATIONS),
    sourceField: optionalString(obj, "sourceField"),
    expression: optionalString(obj, "expression"),
    tags: optionalStringArray(obj, "tags"),
  };
}

export function parseMetricFilterQuery(query: URLSearchParams): {
  cube?: string;
  status?: MetricStatus;
  tag?: string;
} {
  return {
    cube: query.get("cube") ?? undefined,
    status: queryEnum<MetricStatus>(query, "status", METRIC_STATUSES),
    tag: query.get("tag") ?? undefined,
  };
}

export function parseDefineDimension(body: unknown) {
  const obj = asObject(body);
  const levels = optionalObjectArray(obj, "levels")?.map((level) => ({
    key: requireString(level, "key"),
    label: requireString(level, "label"),
  }));
  return {
    key: requireString(obj, "key"),
    label: requireString(obj, "label"),
    type: optionalEnum<DimensionType>(obj, "type", DIMENSION_TYPES),
    description: optionalString(obj, "description"),
    levels,
  };
}

export function parseMembers(body: unknown) {
  const obj = asObject(body);
  const members = optionalObjectArray(obj, "members");
  if (!members || members.length === 0) {
    throw invalid("'members' must be a non-empty array of objects");
  }
  return members.map((member) => ({
    key: requireString(member, "key"),
    label: optionalString(member, "label") ?? requireString(member, "key"),
    levelKey: optionalString(member, "levelKey"),
    parentKey: optionalString(member, "parentKey"),
    attributes: optionalStringRecord(member, "attributes"),
  }));
}

export function parseDefineCube(body: unknown) {
  const obj = asObject(body);
  return {
    name: requireString(obj, "name"),
    title: requireString(obj, "title"),
    description: optionalString(obj, "description"),
    defaultGrain: optionalEnum<TimeGrain>(obj, "defaultGrain", TIME_GRAINS),
    retentionDays: optionalNumber(obj, "retentionDays"),
    dimensions: optionalObjectArray(obj, "dimensions")?.map((dimension) => ({
      factKey: requireString(dimension, "factKey"),
      dimensionKey: optionalString(dimension, "dimensionKey"),
      label: optionalString(dimension, "label"),
      required: optionalBoolean(dimension, "required"),
    })),
    measureFields: optionalObjectArray(obj, "measureFields")?.map((measure) => ({
      field: requireString(measure, "field"),
      label: optionalString(measure, "label"),
      isCurrency: optionalBoolean(measure, "isCurrency"),
    })),
    sourceEventTypes: optionalStringArray(obj, "sourceEventTypes"),
    defaultMetrics: optionalStringArray(obj, "defaultMetrics"),
  };
}

export function parseCubeDimension(body: unknown) {
  const obj = asObject(body);
  return {
    factKey: requireString(obj, "factKey"),
    dimensionKey: optionalString(obj, "dimensionKey"),
    label: optionalString(obj, "label"),
    required: optionalBoolean(obj, "required"),
  };
}

export function parseCubeMeasure(body: unknown) {
  const obj = asObject(body);
  return {
    field: requireString(obj, "field"),
    label: optionalString(obj, "label"),
    isCurrency: optionalBoolean(obj, "isCurrency"),
  };
}

export function parseReason(body: unknown, key = "reason"): string {
  return requireString(asObject(body), key);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function parseFilters(obj: Record<string, unknown>, key = "filters"): DimensionFilter[] | undefined {
  const raw = optionalObjectArray(obj, key);
  if (!raw) return undefined;
  return raw.map((filter) => ({
    dimension: requireString(filter, "dimension"),
    op: requireEnum(filter, "op", FILTER_OPERATORS),
    value: optionalString(filter, "value"),
    values: optionalStringArray(filter, "values"),
  }));
}

function parseHaving(obj: Record<string, unknown>): MetricFilter[] | undefined {
  const raw = optionalObjectArray(obj, "having");
  if (!raw) return undefined;
  return raw.map((having) => ({
    metric: requireString(having, "metric"),
    op: requireEnum(having, "op", HAVING_OPERATORS),
    value: requireNumber(having, "value"),
    upper: optionalNumber(having, "upper"),
  }));
}

function parseOrderBy(obj: Record<string, unknown>): OrderBy[] | undefined {
  const raw = optionalObjectArray(obj, "orderBy");
  if (!raw) return undefined;
  return raw.map((order) => ({
    key: requireString(order, "key"),
    direction: requireEnum(order, "direction", ["asc", "desc"] as const),
  }));
}

function parseTopN(obj: Record<string, unknown>) {
  const raw = obj.topN;
  if (raw === undefined || raw === null) return undefined;
  const topN = asObject(raw, "topN");
  return {
    metric: requireString(topN, "metric"),
    limit: requireNumber(topN, "limit"),
    includeOther: optionalBoolean(topN, "includeOther"),
    otherLabel: optionalString(topN, "otherLabel"),
  };
}

/** `{ from, to }` — inclusive start, exclusive end, both ISO or date-only. */
function parseRange(obj: Record<string, unknown>, key = "timeRange") {
  const raw = obj[key];
  if (raw === undefined || raw === null) return undefined;
  const range = asObject(raw, key);
  return timeRange(requireString(range, "from"), requireString(range, "to"));
}

export function parseCubeQuery(body: unknown): CubeQueryInput {
  const obj = asObject(body);
  return {
    cube: requireString(obj, "cube"),
    metrics: requireStringArray(obj, "metrics"),
    dimensions: optionalStringArray(obj, "dimensions"),
    timeGrain: optionalString(obj, "timeGrain"),
    timeRange: parseRange(obj),
    filters: parseFilters(obj),
    having: parseHaving(obj),
    orderBy: parseOrderBy(obj),
    limit: optionalNumber(obj, "limit"),
    offset: optionalNumber(obj, "offset"),
    topN: parseTopN(obj),
    compareTo: optionalString(obj, "compareTo"),
    densify: optionalBoolean(obj, "densify"),
    includeTotals: optionalBoolean(obj, "includeTotals"),
  };
}

/** A query without its own metric list — the KPI/scalar shape. */
export function parseScalarQuery(body: unknown) {
  const obj = asObject(body);
  return {
    cube: requireString(obj, "cube"),
    metric: requireString(obj, "metric"),
    timeRange: parseRange(obj),
    filters: parseFilters(obj),
  };
}

// ---------------------------------------------------------------------------
// KPIs and dashboards
// ---------------------------------------------------------------------------

export function parseDefineKpi(body: unknown) {
  const obj = asObject(body);
  const thresholds = obj.thresholds === undefined || obj.thresholds === null
    ? undefined
    : asObject(obj.thresholds, "thresholds");
  return {
    code: requireString(obj, "code"),
    name: requireString(obj, "name"),
    cube: requireString(obj, "cube"),
    metricCode: requireString(obj, "metricCode"),
    unit: requireEnum<MetricUnit>(obj, "unit", METRIC_UNITS),
    description: optionalString(obj, "description"),
    direction: optionalEnum<MetricDirection>(obj, "direction", DIRECTIONS),
    grain: optionalEnum<TimeGrain>(obj, "grain", TIME_GRAINS),
    filters: parseFilters(obj),
    target: optionalNumber(obj, "target"),
    thresholds: thresholds
      ? { warning: optionalNumber(thresholds, "warning"), critical: optionalNumber(thresholds, "critical") }
      : undefined,
    sparklinePeriods: optionalNumber(obj, "sparklinePeriods"),
    owner: optionalString(obj, "owner"),
  };
}

export function parseRetarget(body: unknown) {
  const obj = asObject(body);
  const thresholds = obj.thresholds === undefined || obj.thresholds === null
    ? undefined
    : asObject(obj.thresholds, "thresholds");
  return {
    target: optionalNumber(obj, "target"),
    thresholds: thresholds
      ? { warning: optionalNumber(thresholds, "warning"), critical: optionalNumber(thresholds, "critical") }
      : undefined,
  };
}

export function parseCreateDashboard(body: unknown) {
  const obj = asObject(body);
  return {
    code: requireString(obj, "code"),
    title: requireString(obj, "title"),
    description: optionalString(obj, "description"),
    audienceRoles: optionalStringArray(obj, "audienceRoles"),
    refreshIntervalSeconds: optionalNumber(obj, "refreshIntervalSeconds"),
  };
}

function parseLayout(obj: Record<string, unknown>) {
  const raw = obj.layout;
  if (raw === undefined || raw === null) return undefined;
  const layout = asObject(raw, "layout");
  return {
    row: optionalNumber(layout, "row"),
    col: optionalNumber(layout, "col"),
    width: optionalNumber(layout, "width"),
    height: optionalNumber(layout, "height"),
  };
}

function parseWindow(obj: Record<string, unknown>) {
  const raw = obj.window;
  if (raw === undefined || raw === null) return undefined;
  const window = asObject(raw, "window");
  return {
    grain: optionalEnum<TimeGrain>(window, "grain", TIME_GRAINS),
    trailingPeriods: optionalNumber(window, "trailingPeriods"),
    groupByPeriod: optionalBoolean(window, "groupByPeriod"),
  };
}

function parseChart(obj: Record<string, unknown>) {
  const raw = obj.chart;
  if (raw === undefined || raw === null) return undefined;
  const chart = asObject(raw, "chart");
  return { kind: requireEnum<ChartKind>(chart, "kind", CHART_KINDS) };
}

/** Tile queries carry no absolute range; the tile window supplies it. */
function parseTileQuery(obj: Record<string, unknown>) {
  const raw = obj.query;
  if (raw === undefined || raw === null) return undefined;
  const query = asObject(raw, "query");
  return {
    cube: requireString(query, "cube"),
    metrics: requireStringArray(query, "metrics"),
    dimensions: optionalStringArray(query, "dimensions"),
    filters: parseFilters(query),
    having: parseHaving(query),
    orderBy: parseOrderBy(query),
    limit: optionalNumber(query, "limit"),
    offset: optionalNumber(query, "offset"),
    topN: parseTopN(query),
    compareTo: optionalString(query, "compareTo"),
    densify: optionalBoolean(query, "densify"),
    includeTotals: optionalBoolean(query, "includeTotals"),
  };
}

export function parseAddTile(body: unknown) {
  const obj = asObject(body);
  return {
    type: requireEnum<TileType>(obj, "type", TILE_TYPES),
    title: requireString(obj, "title"),
    layout: parseLayout(obj),
    window: parseWindow(obj),
    kpiCode: optionalString(obj, "kpiCode"),
    query: parseTileQuery(obj),
    chart: parseChart(obj),
  };
}

export function parseUpdateTile(body: unknown) {
  const obj = asObject(body);
  return {
    title: optionalString(obj, "title"),
    layout: parseLayout(obj),
    window: parseWindow(obj),
    chart: parseChart(obj),
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

function parseCsvOptions(obj: Record<string, unknown>) {
  const raw = obj.csvOptions;
  if (raw === undefined || raw === null) return undefined;
  const options = asObject(raw, "csvOptions");
  return {
    delimiter: optionalString(options, "delimiter"),
    includeHeader: optionalBoolean(options, "includeHeader"),
    bom: optionalBoolean(options, "bom"),
    lineEnding: optionalEnum(options, "lineEnding", ["\n", "\r\n"] as const),
    nullValue: optionalString(options, "nullValue"),
    rawValues: optionalBoolean(options, "rawValues"),
  };
}

/**
 * Export requests keep the query serialized (`{from, to}` strings rather than
 * a parsed range): a job outlives the request that made it and must be
 * replayable from its stored row.
 */
export function parseExportRequest(body: unknown): { format: ExportFormat; request: ExportRequest } {
  const obj = asObject(body);
  const kind = requireEnum(obj, "kind", EXPORT_KINDS);
  const format = optionalEnum<ExportFormat>(obj, "format", EXPORT_FORMATS) ?? "csv";

  let query: ExportRequest["query"];
  if (obj.query !== undefined && obj.query !== null) {
    const raw = asObject(obj.query, "query");
    const range = raw.timeRange === undefined || raw.timeRange === null
      ? undefined
      : asObject(raw.timeRange, "query.timeRange");
    if (range) {
      // Parsed eagerly so a malformed window fails now rather than inside the
      // worker, where the only signal would be a failed job.
      timeRange(requireString(range, "from"), requireString(range, "to"));
    }
    query = {
      cube: requireString(raw, "cube"),
      metrics: optionalStringArray(raw, "metrics") ?? [],
      dimensions: optionalStringArray(raw, "dimensions"),
      timeGrain: optionalString(raw, "timeGrain"),
      timeRange: range
        ? { from: requireString(range, "from"), to: requireString(range, "to") }
        : undefined,
      filters: parseFilters(raw),
      having: parseHaving(raw),
      orderBy: parseOrderBy(raw),
      limit: optionalNumber(raw, "limit"),
      offset: optionalNumber(raw, "offset"),
      topN: parseTopN(raw),
      compareTo: optionalString(raw, "compareTo"),
      densify: optionalBoolean(raw, "densify"),
      includeTotals: optionalBoolean(raw, "includeTotals"),
    };
  }

  return {
    format,
    request: {
      kind,
      query,
      kpiCodes: optionalStringArray(obj, "kpiCodes"),
      csvOptions: parseCsvOptions(obj),
    },
  };
}

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

export function parseEventBatch(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  const obj = asObject(body);
  const events = obj.events;
  if (!Array.isArray(events)) {
    throw invalid("ingest expects an array of events, or an object with an 'events' array");
  }
  return events;
}

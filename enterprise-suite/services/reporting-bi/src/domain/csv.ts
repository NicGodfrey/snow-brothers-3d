/**
 * CSV / NDJSON rendering for exports.
 *
 * RFC 4180 quoting, plus two things spreadsheets force on anyone who ships
 * CSV to real users:
 *
 *  - **Formula injection**: a cell starting with `=`, `+`, `-`, `@`, tab or
 *    CR is prefixed with an apostrophe so Excel treats it as text instead of
 *    executing it. Dimension members come from upstream systems, so they are
 *    untrusted input.
 *  - **BOM**: optional UTF-8 byte-order mark, because Excel otherwise reads
 *    UTF-8 as the local 8-bit codepage and mangles every non-ASCII label.
 */
import { createHash } from "node:crypto";
import { formatMetricValue, type MetricDefinition } from "./metric.js";
import { PERIOD_KEY, type CubeQueryResult } from "./query.js";

export interface CsvOptions {
  readonly delimiter: string;
  readonly includeHeader: boolean;
  readonly bom: boolean;
  readonly lineEnding: "\n" | "\r\n";
  readonly nullValue: string;
  /** Emit raw numbers instead of unit-formatted strings. */
  readonly rawValues: boolean;
}

export const DEFAULT_CSV_OPTIONS: CsvOptions = {
  delimiter: ",",
  includeHeader: true,
  bom: false,
  lineEnding: "\r\n",
  nullValue: "",
  rawValues: false,
};

const RISKY_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

export function escapeCsvValue(value: unknown, options: CsvOptions = DEFAULT_CSV_OPTIONS): string {
  if (value === null || value === undefined) return options.nullValue;
  let text = typeof value === "string" ? value : String(value);
  if (text.length > 0 && RISKY_PREFIXES.includes(text[0]!)) {
    // Negative numbers are legitimate; only guard non-numeric text.
    if (!/^-?\d/.test(text)) text = `'${text}`;
  }
  const needsQuoting =
    text.includes(options.delimiter) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r");
  return needsQuoting ? `"${text.replace(/"/g, '""')}"` : text;
}

export class CsvWriter {
  private readonly lines: string[] = [];
  private columnCount: number | null = null;

  constructor(private readonly options: CsvOptions = DEFAULT_CSV_OPTIONS) {}

  writeRow(values: readonly unknown[]): void {
    if (this.columnCount === null) this.columnCount = values.length;
    else if (values.length !== this.columnCount) {
      throw new Error(`CSV row has ${values.length} columns, expected ${this.columnCount}`);
    }
    this.lines.push(values.map((v) => escapeCsvValue(v, this.options)).join(this.options.delimiter));
  }

  get rowCount(): number {
    return this.options.includeHeader ? Math.max(0, this.lines.length - 1) : this.lines.length;
  }

  toString(): string {
    const body = this.lines.join(this.options.lineEnding);
    const trailing = this.lines.length > 0 ? this.options.lineEnding : "";
    return `${this.options.bom ? "\uFEFF" : ""}${body}${trailing}`;
  }
}

/** Stable content hash used to detect duplicate/altered export artifacts. */
export function checksumOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function byteLengthOf(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/**
 * Renders a query result as CSV. Dimension columns carry the human label
 * (with the raw member key alongside when they differ, so the file can be
 * joined back to source systems), metric columns the formatted value.
 */
export function renderResultCsv(
  result: CubeQueryResult,
  metrics: ReadonlyMap<string, MetricDefinition>,
  options: Partial<CsvOptions> = {},
): string {
  const opts: CsvOptions = { ...DEFAULT_CSV_OPTIONS, ...options };
  const writer = new CsvWriter(opts);

  const dimensionColumns = result.columns.filter((c) => c.kind !== "metric");
  const metricColumns = result.columns.filter((c) => c.kind === "metric");

  if (opts.includeHeader) {
    const header: string[] = [];
    for (const column of dimensionColumns) {
      header.push(column.label);
      if (column.key !== PERIOD_KEY) header.push(`${column.label} Key`);
    }
    for (const column of metricColumns) header.push(column.label);
    if (result.comparison) {
      for (const column of metricColumns) {
        header.push(`${column.label} (prev)`);
        header.push(`${column.label} Δ%`);
      }
    }
    writer.writeRow(header);
  }

  for (const row of result.rows) {
    const values: unknown[] = [];
    for (const column of dimensionColumns) {
      values.push(row.labels[column.key] ?? row.keys[column.key] ?? "");
      if (column.key !== PERIOD_KEY) values.push(row.keys[column.key] ?? "");
    }
    for (const column of metricColumns) {
      values.push(formatValue(row.metrics[column.key] ?? null, metrics.get(column.key), opts));
    }
    if (result.comparison) {
      for (const column of metricColumns) {
        values.push(formatValue(row.comparison?.[column.key] ?? null, metrics.get(column.key), opts));
        const pct = row.deltaPct?.[column.key] ?? null;
        values.push(pct === null ? opts.nullValue : pct.toFixed(2));
      }
    }
    writer.writeRow(values);
  }

  return writer.toString();
}

function formatValue(
  value: number | null,
  metric: MetricDefinition | undefined,
  options: CsvOptions,
): string {
  if (value === null) return options.nullValue;
  if (options.rawValues || !metric) return String(value);
  return formatMetricValue(metric, value);
}

/** One JSON object per line — the streaming-friendly export format. */
export function renderResultNdjson(result: CubeQueryResult): string {
  return result.rows
    .map((row) =>
      JSON.stringify({
        ...row.keys,
        ...Object.fromEntries(
          Object.entries(row.labels).map(([key, label]) => [`${key}_label`, label]),
        ),
        ...row.metrics,
      }),
    )
    .join("\n")
    .concat(result.rows.length > 0 ? "\n" : "");
}

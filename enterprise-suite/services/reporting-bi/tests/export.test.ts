/**
 * Export jobs and CSV rendering.
 *
 * CSV is the format users open in Excel, which makes two normally-ignorable
 * details load-bearing: RFC 4180 quoting has to be exact, and cells starting
 * with `=` have to be neutralised, because dimension members are untrusted
 * text arriving from upstream systems.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ExportCommand } from "../src/application/export-service.js";
import {
  CsvWriter,
  DEFAULT_CSV_OPTIONS,
  checksumOf,
  escapeCsvValue,
  renderResultNdjson,
} from "../src/domain/csv.js";
import { ReportingEventTypes } from "../src/domain/events.js";
import { MAX_ATTEMPTS } from "../src/domain/export-job.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";
import { createReportingBiModule } from "../src/infrastructure/module.js";
import { appendFacts, harness, NOW, publishedTypes, smallCube, TEST_CUBE, type Harness } from "./helpers.js";

async function seeded(): Promise<Harness> {
  const h = harness();
  await smallCube(h);
  await appendFacts(h, [
    { at: "2026-07-11T10:00:00Z", product: "SKU-1", channel: "web", orders: 3, revenue: 900, units: 9 },
    { at: "2026-08-02T10:00:00Z", product: "SKU-2", channel: "retail", orders: 1, revenue: 200, units: 2 },
  ]);
  return h;
}

const cubeQuery: ExportCommand = {
  format: "csv",
  request: {
    kind: "cube-query",
    query: { cube: TEST_CUBE, metrics: ["revenue", "orders"], dimensions: ["product"] },
  },
};

async function runOne(h: Harness, input: ExportCommand = cubeQuery) {
  const job = await h.module.services.exports.requestExport(h.ctx, input);
  await h.module.services.exports.runNext(h.ctx);
  return h.module.services.exports.getJob(h.ctx, job.jobNumber);
}

describe("csv / escaping", () => {
  it("quotes only what RFC 4180 requires", () => {
    assert.equal(escapeCsvValue("plain"), "plain");
    assert.equal(escapeCsvValue("with,comma"), '"with,comma"');
    assert.equal(escapeCsvValue('say "hi"'), '"say ""hi"""');
    assert.equal(escapeCsvValue("line\nbreak"), '"line\nbreak"');
  });

  it("neutralises formula injection without mangling negative numbers", () => {
    assert.equal(escapeCsvValue("=1+1"), "'=1+1");
    assert.equal(escapeCsvValue("@SUM(A1)"), "'@SUM(A1)");
    assert.equal(escapeCsvValue("-42"), "-42");
    assert.equal(escapeCsvValue("-lookup"), "'-lookup");
  });

  it("renders nulls as the configured placeholder", () => {
    assert.equal(escapeCsvValue(null), "");
    assert.equal(escapeCsvValue(undefined, { ...DEFAULT_CSV_OPTIONS, nullValue: "N/A" }), "N/A");
  });

  it("refuses ragged rows", () => {
    const writer = new CsvWriter();
    writer.writeRow(["a", "b"]);
    assert.throws(() => writer.writeRow(["only-one"]), /expected 2/);
  });

  it("terminates every line, including the last", () => {
    const writer = new CsvWriter();
    writer.writeRow(["a"]);
    writer.writeRow(["b"]);
    assert.equal(writer.toString(), "a\r\nb\r\n");
  });

  it("can emit a BOM and LF endings for the other half of the world", () => {
    const writer = new CsvWriter({ ...DEFAULT_CSV_OPTIONS, bom: true, lineEnding: "\n" });
    writer.writeRow(["ä"]);
    assert.equal(writer.toString(), "\uFEFFä\n");
  });

  it("hashes content so a re-download can be verified", () => {
    assert.equal(checksumOf("abc"), checksumOf("abc"));
    assert.notEqual(checksumOf("abc"), checksumOf("abd"));
  });
});

describe("export / cube queries", () => {
  it("writes a header, a label column and a key column per dimension", async () => {
    const h = await seeded();
    const job = await runOne(h);
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    const lines = artifact.content.trimEnd().split("\r\n");

    assert.equal(job.status, "completed");
    assert.equal(lines[0], "Product,Product Key,Revenue,Orders");
    assert.equal(lines[1], "Widget,SKU-1,9.00,3");
    assert.equal(lines[2], "Gadget,SKU-2,2.00,1");
    assert.equal(job.rowCount, 2);
  });

  it("emits raw numbers when the caller does not want unit formatting", async () => {
    const h = await seeded();
    const job = await runOne(h, {
      ...cubeQuery,
      request: { ...cubeQuery.request, csvOptions: { rawValues: true } },
    });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    assert.match(artifact.content, /Widget,SKU-1,900,3/);
  });

  it("honours delimiter, header and null-value options", async () => {
    const h = await seeded();
    const job = await runOne(h, {
      ...cubeQuery,
      request: {
        ...cubeQuery.request,
        query: { cube: TEST_CUBE, metrics: ["aov"], dimensions: ["channel"] },
        csvOptions: { delimiter: ";", includeHeader: false, nullValue: "-", lineEnding: "\n" as const },
      },
    });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    assert.equal(artifact.content, "web;web;3.00\nretail;retail;2.00\n");
  });

  it("writes one JSON object per line for ndjson", async () => {
    const h = await seeded();
    const job = await runOne(h, { ...cubeQuery, format: "ndjson" });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    const rows = artifact.content.trimEnd().split("\n").map((line) => JSON.parse(line));

    assert.equal(artifact.contentType, "application/x-ndjson");
    assert.deepEqual(rows[0], { product: "SKU-1", product_label: "Widget", revenue: 900, orders: 3 });
  });

  it("includes comparison columns when the query asked for one", async () => {
    const h = await seeded();
    const job = await runOne(h, {
      format: "csv",
      request: {
        kind: "cube-query",
        query: {
          cube: TEST_CUBE,
          metrics: ["revenue"],
          timeGrain: "month",
          timeRange: { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" },
          compareTo: "previous-period",
        },
      },
    });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    const [header, first] = artifact.content.trimEnd().split("\r\n");

    assert.equal(header, "Period,Revenue,Revenue (prev),Revenue Δ%");
    assert.equal(first, "Aug 2026,2.00,9.00,-77.78");
  });

  it("renders an empty result as a header and nothing else", async () => {
    const h = await seeded();
    const job = await runOne(h, {
      format: "csv",
      request: {
        kind: "cube-query",
        query: {
          cube: TEST_CUBE,
          metrics: ["revenue"],
          dimensions: ["product"],
          filters: [{ dimension: "product", op: "eq", value: "nothing" }],
        },
      },
    });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    assert.equal(artifact.content, "Product,Product Key,Revenue\r\n");
    assert.equal(job.rowCount, 0);
  });

  it("keeps NDJSON of an empty result genuinely empty", () => {
    assert.equal(
      renderResultNdjson({
        cube: TEST_CUBE,
        generatedAt: "2026-08-12T09:00:00.000Z" as never,
        columns: [],
        rows: [],
        totals: {},
        rowCount: 0,
        groupCount: 0,
        factsScanned: 0,
        truncated: false,
      }),
      "",
    );
  });
});

describe("export / other shapes", () => {
  it("dumps raw facts with their source event for reconciliation", async () => {
    const h = await seeded();
    const job = await runOne(h, {
      format: "csv",
      request: { kind: "fact-dump", query: { cube: TEST_CUBE, metrics: [] } },
    });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    const [header, first] = artifact.content.trimEnd().split("\r\n");

    assert.equal(
      header,
      "fact_id,occurred_at,product,channel,orders,revenue_minor,units,currency,source_event_id,source_event_type",
    );
    // Oldest first, so the file reads as a chronological ledger.
    assert.match(first, /2026-07-11T10:00:00\.000Z,SKU-1,web,3,900,9,,/);
    assert.equal(job.rowCount, 2);
  });

  it("narrows a fact dump to a window", async () => {
    const h = await seeded();
    const job = await runOne(h, {
      format: "csv",
      request: {
        kind: "fact-dump",
        query: {
          cube: TEST_CUBE,
          metrics: [],
          timeRange: { from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" },
        },
      },
    });
    assert.equal(job.rowCount, 1);
  });

  it("exports the KPI scorecard with attainment and status", async () => {
    const h = await seeded();
    await h.module.services.kpis.defineKpi(h.ctx, {
      code: "monthly_revenue",
      name: "Monthly revenue",
      cube: TEST_CUBE,
      metricCode: "revenue",
      unit: "currency",
      grain: "month",
      target: 400,
    });

    const job = await runOne(h, { format: "csv", request: { kind: "kpi-scorecard" } });
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);
    const [header, row] = artifact.content.trimEnd().split("\r\n");

    assert.match(header, /^kpi_code,name,period,value,target,attainment_pct/);
    assert.match(row, /^monthly_revenue,Monthly revenue,2026-08,2\.00,4\.00,50\.0/);
    assert.match(row, /off-track/);
  });

  it("refuses an export kind that needs a query but has none", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.exports.requestExport(h.ctx, {
        format: "csv",
        request: { kind: "cube-query" },
      }),
      /requires a query/,
    );
  });

  it("refuses a query against a cube that does not exist", async () => {
    const h = await seeded();
    await assert.rejects(
      h.module.services.exports.requestExport(h.ctx, {
        format: "csv",
        request: { kind: "cube-query", query: { cube: "ghost", metrics: ["revenue"] } },
      }),
      /not found/i,
    );
  });
});

describe("export / job lifecycle", () => {
  it("numbers jobs and walks queued -> running -> completed", async () => {
    const h = await seeded();
    const requested = await h.module.services.exports.requestExport(h.ctx, cubeQuery);
    assert.equal(requested.status, "queued");
    assert.match(requested.jobNumber, /^EXP-2026-\d{6}$/);

    const finished = await h.module.services.exports.runNext(h.ctx);
    assert.equal(finished?.status, "completed");
    assert.equal(finished?.attempts, 1);
    assert.equal(finished?.durationMs(), 0); // fixed clock
    assert.equal(await h.module.services.exports.runNext(h.ctx), null);
  });

  it("runs the queue oldest first", async () => {
    const h = await seeded();
    const first = await h.module.services.exports.requestExport(h.ctx, cubeQuery);
    const second = await h.module.services.exports.requestExport(h.ctx, cubeQuery);

    const drained = await h.module.services.exports.drain(h.ctx);
    assert.deepEqual(drained.map((job) => job.jobNumber), [first.jobNumber, second.jobNumber]);
  });

  it("records a failure with its error code and allows a bounded retry", async () => {
    const h = await seeded();
    // Passes the request-time cube check, then fails when the metric is resolved.
    const requested = await h.module.services.exports.requestExport(h.ctx, {
      format: "csv",
      request: { kind: "cube-query", query: { cube: TEST_CUBE, metrics: ["ghost_metric"] } },
    });
    const failed = await h.module.services.exports.runNext(h.ctx);

    assert.equal(failed?.status, "failed");
    assert.match(failed?.error?.message ?? "", /ghost_metric/);

    await h.module.services.exports.retry(h.ctx, requested.jobNumber);
    const again = await h.module.services.exports.runNext(h.ctx);
    assert.equal(again?.attempts, 2);

    await h.module.services.exports.retry(h.ctx, requested.jobNumber);
    await h.module.services.exports.runNext(h.ctx);
    await assert.rejects(
      h.module.services.exports.retry(h.ctx, requested.jobNumber),
      new RegExp(`exhausted its ${MAX_ATTEMPTS} attempts`),
    );
  });

  it("refuses to retry a job that did not fail", async () => {
    const h = await seeded();
    const job = await runOne(h);
    await assert.rejects(h.module.services.exports.retry(h.ctx, job.jobNumber), /only failed exports/);
  });

  it("cancels a queued job and will not cancel it twice", async () => {
    const h = await seeded();
    const job = await h.module.services.exports.requestExport(h.ctx, cubeQuery);
    const cancelled = await h.module.services.exports.cancel(h.ctx, job.jobNumber, "user changed their mind");

    assert.equal(cancelled.status, "cancelled");
    assert.equal(await h.module.services.exports.runNext(h.ctx), null);
    await assert.rejects(
      h.module.services.exports.cancel(h.ctx, job.jobNumber, "again"),
      /already 'cancelled'/,
    );
  });

  it("requires a reason to cancel", async () => {
    const h = await seeded();
    const job = await h.module.services.exports.requestExport(h.ctx, cubeQuery);
    await assert.rejects(h.module.services.exports.cancel(h.ctx, job.jobNumber, "  "), /reason is required/);
  });

  it("fails a job whose result is larger than the configured limit", async () => {
    const clock = new FixedClock(NOW);
    const h: Harness = {
      clock,
      ctx: harness().ctx,
      module: createReportingBiModule({ clock, queryCacheSize: 0, exports: { maxRows: 1 } }),
    };
    await smallCube(h);
    await appendFacts(h, [
      { at: "2026-08-01T00:00:00Z", product: "SKU-1" },
      { at: "2026-08-01T00:00:00Z", product: "SKU-2" },
    ]);

    const job = await runOne(h, {
      format: "csv",
      request: { kind: "cube-query", query: { cube: TEST_CUBE, metrics: ["orders"], dimensions: ["product"] } },
    });
    assert.equal(job.status, "failed");
    assert.match(job.error?.message ?? "", /above the 1 row limit/);
  });

  it("announces the whole lifecycle on the outbox", async () => {
    const h = await seeded();
    await h.module.outbox.drain();
    await runOne(h);

    assert.deepEqual(await publishedTypes(h), [
      ReportingEventTypes.ExportRequested,
      ReportingEventTypes.ExportStarted,
      ReportingEventTypes.ExportCompleted,
    ]);
  });

  it("filters the job list by status", async () => {
    const h = await seeded();
    await runOne(h);
    await h.module.services.exports.requestExport(h.ctx, cubeQuery);

    assert.equal((await h.module.services.exports.listJobs(h.ctx, { status: "completed" })).length, 1);
    assert.equal((await h.module.services.exports.listJobs(h.ctx, { status: "queued" })).length, 1);
    assert.equal((await h.module.services.exports.listJobs(h.ctx)).length, 2);
  });
});

describe("export / artifacts", () => {
  it("stores the artifact with a checksum and a byte size", async () => {
    const h = await seeded();
    const job = await runOne(h);
    const artifact = await h.module.services.exports.getArtifact(h.ctx, job.jobNumber);

    assert.equal(artifact.checksum, job.checksum);
    assert.equal(artifact.byteSize, job.byteSize);
    assert.equal(artifact.checksum, checksumOf(artifact.content));
    assert.equal(artifact.contentType, "text/csv; charset=utf-8");
    assert.equal(artifact.key, `exports/${job.jobNumber}.csv`);
  });

  it("will not hand back an artifact for a job that has not completed", async () => {
    const h = await seeded();
    const job = await h.module.services.exports.requestExport(h.ctx, cubeQuery);
    await assert.rejects(
      h.module.services.exports.getArtifact(h.ctx, job.jobNumber),
      /is 'queued' and has no artifact/,
    );
  });

  it("stops serving an artifact once its retention window closes", async () => {
    const h = await seeded();
    const job = await runOne(h);
    h.clock.advance(73 * 3_600_000);

    await assert.rejects(h.module.services.exports.getArtifact(h.ctx, job.jobNumber), /expired at/);
  });

  it("reports an unknown job rather than an empty download", async () => {
    const h = await seeded();
    await assert.rejects(h.module.services.exports.getJob(h.ctx, "EXP-2026-999999"), /not found/i);
  });
});

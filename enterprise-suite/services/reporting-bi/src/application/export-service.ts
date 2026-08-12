/**
 * Export jobs: request, run, retrieve.
 *
 * `runNext` is a worker tick, not a background thread. Keeping the loop
 * external means tests drive it deterministically, the HTTP API can offer a
 * "run now" for small exports, and a real deployment can put whatever
 * scheduler it likes in front without this service knowing.
 *
 * Three export shapes are supported:
 *
 *  - **cube-query**  the aggregated table a user is looking at
 *  - **fact-dump**   raw facts of a cube, for reconciliation against source
 *  - **kpi-scorecard** every active KPI with target, attainment and status
 */
import {
  ConflictError,
  NotFoundError,
  type IsoDateTime,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  CsvWriter,
  DEFAULT_CSV_OPTIONS,
  renderResultCsv,
  renderResultNdjson,
  type CsvOptions,
} from "../domain/csv.js";
import { QueryError } from "../domain/errors.js";
import {
  ExportJob,
  type ExportFormat,
  type ExportRequest,
  type ExportStatus,
} from "../domain/export-job.js";
import { formatMetricValue } from "../domain/metric.js";
import type { CubeQueryInput } from "../domain/query.js";
import type { CubeRepository, ExportJobRepository, FactRepository } from "../domain/repositories.js";
import { timeRange } from "../domain/time-grain.js";
import type { KpiService } from "./kpi-service.js";
import { documentSeries, type BlobStore, type Clock, type NumberSeries, type Outbox, type StoredArtifact } from "./ports.js";
import type { QueryService } from "./query-service.js";

export interface ExportServiceOptions {
  /** Hours an artifact stays retrievable. 0 keeps it forever. */
  readonly retentionHours?: number;
  /** Rows above this fail the job rather than build a giant string. */
  readonly maxRows?: number;
}

/** What a caller asks for; the aggregate adds numbering and provenance. */
export interface ExportCommand {
  format: ExportFormat;
  request: ExportRequest;
}

export class ExportService {
  private readonly retentionHours: number;
  private readonly maxRows: number;

  constructor(
    private readonly jobs: ExportJobRepository,
    private readonly blobs: BlobStore,
    private readonly queries: QueryService,
    private readonly kpis: KpiService,
    private readonly facts: FactRepository,
    private readonly cubes: CubeRepository,
    private readonly outbox: Outbox,
    private readonly numbers: NumberSeries,
    private readonly clock: Clock,
    options?: ExportServiceOptions,
  ) {
    this.retentionHours = options?.retentionHours ?? 72;
    this.maxRows = options?.maxRows ?? 100_000;
  }

  async requestExport(ctx: TenantContext, input: ExportCommand): Promise<ExportJob> {
    const jobNumber = await this.numbers.next(ctx.tenantId, documentSeries.export);
    const job = ExportJob.request(ctx.tenantId, {
      jobNumber,
      format: input.format,
      request: input.request,
      requestedBy: ctx.userId,
      requestedAt: this.clock.now(),
    });
    if (input.request.query?.cube) {
      const cube = await this.cubes.findByName(ctx.tenantId, input.request.query.cube);
      if (!cube) throw new NotFoundError("Cube", input.request.query.cube);
    }
    await this.flush(job);
    return job;
  }

  async getJob(ctx: TenantContext, jobNumber: string): Promise<ExportJob> {
    const job = await this.jobs.findByNumber(ctx.tenantId, jobNumber);
    if (!job) throw new NotFoundError("ExportJob", jobNumber);
    return job;
  }

  async listJobs(
    ctx: TenantContext,
    filter?: { status?: ExportStatus; limit?: number },
  ): Promise<ExportJob[]> {
    return this.jobs.list(ctx.tenantId, filter);
  }

  /** Runs the oldest queued job, if any. Returns null when idle. */
  async runNext(ctx: TenantContext): Promise<ExportJob | null> {
    const job = await this.jobs.nextQueued(ctx.tenantId);
    if (!job) return null;
    return this.execute(ctx, job);
  }

  /** Drains the queue, bounded so a worker tick cannot run forever. */
  async drain(ctx: TenantContext, maxJobs = 25): Promise<ExportJob[]> {
    const completed: ExportJob[] = [];
    for (let i = 0; i < maxJobs; i += 1) {
      const job = await this.runNext(ctx);
      if (!job) break;
      completed.push(job);
    }
    return completed;
  }

  async cancel(ctx: TenantContext, jobNumber: string, reason: string): Promise<ExportJob> {
    const job = await this.getJob(ctx, jobNumber);
    job.cancel(reason, this.clock.now());
    await this.flush(job);
    return job;
  }

  async retry(ctx: TenantContext, jobNumber: string): Promise<ExportJob> {
    const job = await this.getJob(ctx, jobNumber);
    job.retry();
    await this.flush(job);
    return job;
  }

  async getArtifact(ctx: TenantContext, jobNumber: string): Promise<StoredArtifact> {
    const job = await this.getJob(ctx, jobNumber);
    if (job.status !== "completed" || !job.artifactKey) {
      throw new ConflictError(`export ${jobNumber} is '${job.status}' and has no artifact`);
    }
    if (job.isExpired(this.clock.now())) {
      throw new ConflictError(`export ${jobNumber} expired at ${job.expiresAt}`);
    }
    const artifact = await this.blobs.get(ctx.tenantId, job.artifactKey);
    if (!artifact) throw new NotFoundError("ExportArtifact", job.artifactKey);
    return artifact;
  }

  private async execute(ctx: TenantContext, job: ExportJob): Promise<ExportJob> {
    job.start(this.clock.now());
    await this.flush(job);

    try {
      const rendered = await this.render(ctx, job);
      if (rendered.rowCount > this.maxRows) {
        throw new QueryError(
          `export would contain ${rendered.rowCount} rows, above the ${this.maxRows} row limit`,
        );
      }
      const key = `exports/${job.jobNumber}.${job.format === "csv" ? "csv" : "ndjson"}`;
      const expiresAt = this.expiryFrom(this.clock.now());
      const artifact = await this.blobs.put({
        tenantId: ctx.tenantId,
        key,
        content: rendered.content,
        contentType: job.format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
        expiresAt,
      });
      job.complete({
        rowCount: rendered.rowCount,
        byteSize: artifact.byteSize,
        checksum: artifact.checksum,
        artifactKey: artifact.key,
        at: this.clock.now(),
        expiresAt,
      });
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String((error as { code: unknown }).code)
          : "EXPORT_FAILED";
      job.fail(code, error instanceof Error ? error.message : String(error), this.clock.now());
    }

    await this.flush(job);
    return job;
  }

  private async render(
    ctx: TenantContext,
    job: ExportJob,
  ): Promise<{ content: string; rowCount: number }> {
    switch (job.request.kind) {
      case "cube-query":
        return this.renderCubeQuery(ctx, job);
      case "fact-dump":
        return this.renderFactDump(ctx, job);
      case "kpi-scorecard":
        return this.renderScorecard(ctx, job);
    }
  }

  private async renderCubeQuery(
    ctx: TenantContext,
    job: ExportJob,
  ): Promise<{ content: string; rowCount: number }> {
    const input = this.toQueryInput(job);
    const { result, metrics } = await this.queries.runWithMetrics(ctx, input);
    const content =
      job.format === "csv"
        ? renderResultCsv(result, metrics, job.request.csvOptions)
        : renderResultNdjson(result);
    return { content, rowCount: result.rows.length };
  }

  /**
   * Raw facts, one row per stored fact, with the source event id so the file
   * can be reconciled line by line against the emitting service.
   */
  private async renderFactDump(
    ctx: TenantContext,
    job: ExportJob,
  ): Promise<{ content: string; rowCount: number }> {
    const spec = job.request.query;
    if (!spec?.cube) throw new QueryError("fact-dump requires a cube");
    const cube = await this.cubes.findByName(ctx.tenantId, spec.cube);
    if (!cube) throw new NotFoundError("Cube", spec.cube);
    const range = spec.timeRange ? timeRange(spec.timeRange.from, spec.timeRange.to) : undefined;

    const facts = await this.facts.scan(ctx.tenantId, {
      cube: spec.cube,
      from: range?.from,
      toExclusive: range?.toExclusive,
    });
    const sorted = [...facts].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

    if (job.format === "ndjson") {
      const lines = sorted.map((fact) =>
        JSON.stringify({
          factId: fact.factId,
          occurredAt: fact.occurredAt,
          ...fact.dimensions,
          ...fact.measures,
          currency: fact.currency,
          sourceEventId: fact.source.eventId,
          sourceEventType: fact.source.eventType,
        }),
      );
      return { content: `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, rowCount: lines.length };
    }

    const options: CsvOptions = { ...DEFAULT_CSV_OPTIONS, ...job.request.csvOptions };
    const writer = new CsvWriter(options);
    const dimensionKeys = cube.dimensions.map((d) => d.factKey);
    const measureKeys = cube.measureFields.map((m) => m.field);
    if (options.includeHeader) {
      writer.writeRow([
        "fact_id",
        "occurred_at",
        ...dimensionKeys,
        ...measureKeys,
        "currency",
        "source_event_id",
        "source_event_type",
      ]);
    }
    for (const fact of sorted) {
      writer.writeRow([
        fact.factId,
        fact.occurredAt,
        ...dimensionKeys.map((key) => fact.dimensions[key] ?? ""),
        ...measureKeys.map((key) => fact.measures[key] ?? ""),
        fact.currency ?? "",
        fact.source.eventId,
        fact.source.eventType,
      ]);
    }
    return { content: writer.toString(), rowCount: sorted.length };
  }

  private async renderScorecard(
    ctx: TenantContext,
    job: ExportJob,
  ): Promise<{ content: string; rowCount: number }> {
    const entries = await this.kpis.scorecard(ctx, job.request.kpiCodes);
    if (job.format === "ndjson") {
      const lines = entries.map((entry) => JSON.stringify(entry.snapshot));
      return { content: `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, rowCount: lines.length };
    }

    const options: CsvOptions = { ...DEFAULT_CSV_OPTIONS, ...job.request.csvOptions };
    const writer = new CsvWriter(options);
    if (options.includeHeader) {
      writer.writeRow([
        "kpi_code",
        "name",
        "period",
        "value",
        "target",
        "attainment_pct",
        "variance",
        "previous_value",
        "change_pct",
        "status",
        "trend",
      ]);
    }
    for (const { snapshot } of entries) {
      const unit = { unit: snapshot.unit, decimals: snapshot.unit === "currency" ? 2 : 2 };
      writer.writeRow([
        snapshot.kpiCode,
        snapshot.name,
        snapshot.period,
        formatMetricValue(unit, snapshot.value),
        formatMetricValue(unit, snapshot.targetValue),
        snapshot.attainment === null ? "" : (snapshot.attainment * 100).toFixed(1),
        formatMetricValue(unit, snapshot.variance),
        formatMetricValue(unit, snapshot.previousValue),
        snapshot.changePct === null ? "" : snapshot.changePct.toFixed(1),
        snapshot.status,
        snapshot.trend,
      ]);
    }
    return { content: writer.toString(), rowCount: entries.length };
  }

  private toQueryInput(job: ExportJob): CubeQueryInput {
    const spec = job.request.query;
    if (!spec) throw new QueryError("export request has no query");
    const { timeRange: serialized, ...rest } = spec;
    return {
      ...rest,
      timeRange: serialized ? timeRange(serialized.from, serialized.to) : undefined,
    };
  }

  private expiryFrom(now: IsoDateTime): IsoDateTime | undefined {
    if (this.retentionHours === 0) return undefined;
    return new Date(new Date(now).getTime() + this.retentionHours * 3_600_000).toISOString() as IsoDateTime;
  }

  private async flush(job: ExportJob): Promise<void> {
    await this.jobs.save(job);
    await this.outbox.append(job.pullEvents());
  }
}
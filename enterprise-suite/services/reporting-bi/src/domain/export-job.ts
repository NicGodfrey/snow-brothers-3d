/**
 * Export jobs.
 *
 * Exports are modelled as jobs rather than synchronous downloads because a
 * warehouse export is unbounded work: a finance user asking for "every
 * invoice fact this year" must not hold an HTTP connection open, and the
 * result needs a retrievable, checksummed artifact that can be re-downloaded
 * without recomputing.
 *
 *   queued -> running -> completed
 *                     -> failed -> queued (retry, bounded attempts)
 *   queued | running  -> cancelled
 *
 * The artifact itself lives in a blob store keyed by `artifactKey`; the
 * aggregate keeps only the metadata needed to serve or expire it.
 */
import {
  AggregateRoot,
  ConflictError,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import type { CsvOptions } from "./csv.js";
import { DefinitionError } from "./errors.js";
import { ReportingEventTypes, type ExportCompletedPayload, type ExportFailedPayload } from "./events.js";
import type { CubeQueryInput } from "./query.js";

export type ExportFormat = "csv" | "ndjson";

export const EXPORT_FORMATS: readonly ExportFormat[] = ["csv", "ndjson"];

export type ExportStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ExportKind = "cube-query" | "kpi-scorecard" | "fact-dump";

export const EXPORT_KINDS: readonly ExportKind[] = ["cube-query", "kpi-scorecard", "fact-dump"];

/** Serializable window; jobs outlive the request that created them. */
export interface SerializedRange {
  readonly from: string;
  readonly to: string;
}

export interface ExportRequest {
  readonly kind: ExportKind;
  /** cube-query / fact-dump: what to run. */
  readonly query?: Omit<CubeQueryInput, "timeRange"> & { timeRange?: SerializedRange };
  /** kpi-scorecard: which KPIs to snapshot. Empty means all active ones. */
  readonly kpiCodes?: readonly string[];
  readonly csvOptions?: Partial<CsvOptions>;
}

export const MAX_ATTEMPTS = 3;

interface ExportJobProps {
  jobNumber: string;
  format: ExportFormat;
  request: ExportRequest;
  status: ExportStatus;
  requestedBy: UserId;
  requestedAt: IsoDateTime;
  startedAt?: IsoDateTime;
  finishedAt?: IsoDateTime;
  attempts: number;
  rowCount?: number;
  byteSize?: number;
  checksum?: string;
  artifactKey?: string;
  expiresAt?: IsoDateTime;
  error?: { code: string; message: string };
  cancellation?: { reason: string; at: IsoDateTime };
}

export interface RequestExportInput {
  jobNumber: string;
  format: ExportFormat;
  request: ExportRequest;
  requestedBy: UserId;
  requestedAt: IsoDateTime;
}

export class ExportJob extends AggregateRoot<ExportJobProps> {
  private constructor(tenantId: TenantId, props: ExportJobProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static request(tenantId: TenantId, input: RequestExportInput): ExportJob {
    if (!EXPORT_FORMATS.includes(input.format)) {
      throw new DefinitionError(`unknown export format '${input.format}'`);
    }
    if (!EXPORT_KINDS.includes(input.request.kind)) {
      throw new DefinitionError(`unknown export kind '${input.request.kind}'`);
    }
    if (input.request.kind !== "kpi-scorecard" && !input.request.query) {
      throw new DefinitionError(`a ${input.request.kind} export requires a query`);
    }
    if (input.request.kind === "kpi-scorecard" && input.format !== "csv" && input.format !== "ndjson") {
      throw new DefinitionError("scorecard exports support csv and ndjson only");
    }

    const job = new ExportJob(tenantId, {
      jobNumber: input.jobNumber,
      format: input.format,
      request: input.request,
      status: "queued",
      requestedBy: input.requestedBy,
      requestedAt: input.requestedAt,
      attempts: 0,
    });
    job.raise(
      envelope({
        eventType: ReportingEventTypes.ExportRequested,
        aggregateType: "ExportJob",
        aggregateId: job.id,
        tenantId,
        payload: {
          jobNumber: input.jobNumber,
          format: input.format,
          kind: input.request.kind,
          cube: input.request.query?.cube,
        },
      }),
    );
    return job;
  }

  static rehydrate(
    tenantId: TenantId,
    props: ExportJobProps,
    existing: Partial<EntityProps>,
  ): ExportJob {
    return new ExportJob(tenantId, props, existing);
  }

  get jobNumber(): string { return this.props.jobNumber; }
  get format(): ExportFormat { return this.props.format; }
  get request(): ExportRequest { return this.props.request; }
  get status(): ExportStatus { return this.props.status; }
  get requestedBy(): UserId { return this.props.requestedBy; }
  get requestedAt(): IsoDateTime { return this.props.requestedAt; }
  get startedAt(): IsoDateTime | undefined { return this.props.startedAt; }
  get finishedAt(): IsoDateTime | undefined { return this.props.finishedAt; }
  get attempts(): number { return this.props.attempts; }
  get rowCount(): number | undefined { return this.props.rowCount; }
  get byteSize(): number | undefined { return this.props.byteSize; }
  get checksum(): string | undefined { return this.props.checksum; }
  get artifactKey(): string | undefined { return this.props.artifactKey; }
  get expiresAt(): IsoDateTime | undefined { return this.props.expiresAt; }
  get error(): { code: string; message: string } | undefined { return this.props.error; }

  get isTerminal(): boolean {
    return ["completed", "failed", "cancelled"].includes(this.props.status);
  }

  start(at: IsoDateTime): void {
    if (this.props.status !== "queued") {
      throw new ConflictError(`export ${this.props.jobNumber} is '${this.props.status}', expected 'queued'`);
    }
    this.props.status = "running";
    this.props.startedAt = at;
    this.props.attempts += 1;
    this.raise(
      envelope({
        eventType: ReportingEventTypes.ExportStarted,
        aggregateType: "ExportJob",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { jobNumber: this.props.jobNumber, attempt: this.props.attempts },
      }),
    );
  }

  complete(input: {
    rowCount: number;
    byteSize: number;
    checksum: string;
    artifactKey: string;
    at: IsoDateTime;
    expiresAt?: IsoDateTime;
  }): void {
    if (this.props.status !== "running") {
      throw new ConflictError(`export ${this.props.jobNumber} is '${this.props.status}', expected 'running'`);
    }
    if (input.rowCount < 0 || input.byteSize < 0) {
      throw new DefinitionError("export row count and byte size must be non-negative");
    }
    this.props.status = "completed";
    this.props.finishedAt = input.at;
    this.props.rowCount = input.rowCount;
    this.props.byteSize = input.byteSize;
    this.props.checksum = input.checksum;
    this.props.artifactKey = input.artifactKey;
    this.props.expiresAt = input.expiresAt;
    this.props.error = undefined;

    const payload: ExportCompletedPayload = {
      jobNumber: this.props.jobNumber,
      format: this.props.format,
      rowCount: input.rowCount,
      byteSize: input.byteSize,
      artifactKey: input.artifactKey,
      checksum: input.checksum,
      expiresAt: input.expiresAt,
    };
    this.raise(
      envelope({
        eventType: ReportingEventTypes.ExportCompleted,
        aggregateType: "ExportJob",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  fail(code: string, message: string, at: IsoDateTime): void {
    if (this.props.status !== "running") {
      throw new ConflictError(`export ${this.props.jobNumber} is '${this.props.status}', expected 'running'`);
    }
    this.props.status = "failed";
    this.props.finishedAt = at;
    this.props.error = { code, message };

    const payload: ExportFailedPayload = {
      jobNumber: this.props.jobNumber,
      format: this.props.format,
      errorCode: code,
      message,
    };
    this.raise(
      envelope({
        eventType: ReportingEventTypes.ExportFailed,
        aggregateType: "ExportJob",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  /** Re-queues a failed job while attempts remain. */
  retry(): void {
    if (this.props.status !== "failed") {
      throw new ConflictError(`only failed exports can be retried (status: ${this.props.status})`);
    }
    if (this.props.attempts >= MAX_ATTEMPTS) {
      throw new ConflictError(
        `export ${this.props.jobNumber} exhausted its ${MAX_ATTEMPTS} attempts`,
      );
    }
    this.props.status = "queued";
    this.props.finishedAt = undefined;
    this.touch();
  }

  cancel(reason: string, at: IsoDateTime): void {
    if (!reason.trim()) throw new DefinitionError("cancellation reason is required");
    if (this.isTerminal) {
      throw new ConflictError(`export ${this.props.jobNumber} is already '${this.props.status}'`);
    }
    this.props.status = "cancelled";
    this.props.finishedAt = at;
    this.props.cancellation = { reason: reason.trim(), at };
    this.raise(
      envelope({
        eventType: ReportingEventTypes.ExportCancelled,
        aggregateType: "ExportJob",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { jobNumber: this.props.jobNumber, reason: reason.trim() },
      }),
    );
  }

  /** True once the artifact is past its retention window. */
  isExpired(now: IsoDateTime): boolean {
    return this.props.expiresAt !== undefined && this.props.expiresAt <= now;
  }

  /** Wall-clock duration of the last run, in milliseconds. */
  durationMs(): number | undefined {
    if (!this.props.startedAt || !this.props.finishedAt) return undefined;
    return new Date(this.props.finishedAt).getTime() - new Date(this.props.startedAt).getTime();
  }
}

import {
  AggregateRoot,
  DomainError,
  envelope,
  type IsoDateTime,
  nowIso,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { SupplyChainEvents, type PlanningRunCompletedPayload } from "./events.js";
import { assertIntInRange, type LocationCode } from "./types.js";

export type PlanningRunStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "FAILED";

export type PlanningScope =
  | { readonly type: "ALL_ITEMS" }
  | { readonly type: "ITEMS"; readonly skus: readonly string[] };

export type AuditLevel = "INFO" | "WARN" | "ERROR";

/**
 * Immutable trace of what the planning engine did and why. Sequenced per run
 * so support can replay decisions ("why did MRP order 500 of RM-STEEL?").
 */
export interface AuditEntry {
  readonly seq: number;
  readonly at: IsoDateTime;
  readonly level: AuditLevel;
  readonly message: string;
  readonly context: Record<string, unknown> | null;
}

export interface PlanningRunStats {
  readonly itemsPlanned: number;
  readonly ordersCreated: number;
  readonly exceptionCount: number;
  readonly levelsProcessed: number;
  readonly elapsedMs: number;
}

interface PlanningRunProps {
  name: string;
  location: LocationCode;
  horizonWeeks: number;
  scope: PlanningScope;
  status: PlanningRunStatus;
  startedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  failureReason: string | null;
  stats: PlanningRunStats | null;
  audit: readonly AuditEntry[];
}

function parseScope(input: unknown): PlanningScope {
  if (input === undefined || input === null) return { type: "ALL_ITEMS" };
  const raw = input as Record<string, unknown>;
  if (raw.type === "ALL_ITEMS") return { type: "ALL_ITEMS" };
  if (raw.type === "ITEMS") {
    if (!Array.isArray(raw.skus) || raw.skus.length === 0 || !raw.skus.every((s) => typeof s === "string" && s.trim())) {
      throw new DomainError("scope.skus must be a non-empty string array", "VALIDATION");
    }
    return { type: "ITEMS", skus: raw.skus.map((s: string) => s.trim().toUpperCase()) };
  }
  throw new DomainError("scope.type must be ALL_ITEMS or ITEMS", "VALIDATION");
}

/**
 * One execution of the MRP engine over a location and horizon. Lifecycle:
 * DRAFT -> RUNNING -> COMPLETED | FAILED. The audit log accumulates through
 * every phase and survives failure, which is precisely when it matters.
 */
export class PlanningRun extends AggregateRoot<PlanningRunProps> {
  static create(
    tenantId: TenantId,
    input: { name?: string; location: LocationCode; horizonWeeks: number; scope?: unknown },
  ): PlanningRun {
    return new PlanningRun(tenantId, {
      name: input.name?.trim() || `MRP run ${new Date().toISOString().slice(0, 16)}`,
      location: input.location,
      horizonWeeks: assertIntInRange("horizonWeeks", input.horizonWeeks, 1, 104),
      scope: parseScope(input.scope),
      status: "DRAFT",
      startedAt: null,
      completedAt: null,
      failureReason: null,
      stats: null,
      audit: [],
    });
  }

  get status(): PlanningRunStatus {
    return this.props.status;
  }

  get location(): LocationCode {
    return this.props.location;
  }

  get horizonWeeks(): number {
    return this.props.horizonWeeks;
  }

  get scope(): PlanningScope {
    return this.props.scope;
  }

  get audit(): readonly AuditEntry[] {
    return this.props.audit;
  }

  get stats(): PlanningRunStats | null {
    return this.props.stats;
  }

  start(): void {
    if (this.props.status !== "DRAFT") {
      throw new DomainError(`Run is ${this.props.status}; only DRAFT runs can start`, "CONFLICT", 409);
    }
    this.props = { ...this.props, status: "RUNNING", startedAt: nowIso() };
    this.log("INFO", "Planning run started", {
      location: this.props.location,
      horizonWeeks: this.props.horizonWeeks,
      scope: this.props.scope,
    });
    this.raise(
      envelope({
        eventType: SupplyChainEvents.PlanningRunStarted,
        aggregateType: "PlanningRun",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { runId: this.id, location: this.props.location, horizonWeeks: this.props.horizonWeeks },
      }),
    );
  }

  log(level: AuditLevel, message: string, context?: Record<string, unknown>): void {
    if (this.props.status !== "RUNNING" && this.props.status !== "DRAFT") {
      throw new DomainError("Cannot append audit entries to a finished run", "CONFLICT", 409);
    }
    const entry: AuditEntry = {
      seq: this.props.audit.length + 1,
      at: nowIso(),
      level,
      message,
      context: context ?? null,
    };
    this.props = { ...this.props, audit: [...this.props.audit, entry] };
  }

  complete(stats: PlanningRunStats): void {
    if (this.props.status !== "RUNNING") {
      throw new DomainError(`Run is ${this.props.status}; only RUNNING runs can complete`, "CONFLICT", 409);
    }
    this.log("INFO", "Planning run completed", { ...stats });
    this.props = { ...this.props, status: "COMPLETED", completedAt: nowIso(), stats };
    const payload: PlanningRunCompletedPayload = {
      runId: this.id,
      location: this.props.location,
      itemsPlanned: stats.itemsPlanned,
      ordersCreated: stats.ordersCreated,
      exceptionCount: stats.exceptionCount,
      levelsProcessed: stats.levelsProcessed,
    };
    this.raise(
      envelope({
        eventType: SupplyChainEvents.PlanningRunCompleted,
        aggregateType: "PlanningRun",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  fail(reason: string): void {
    if (this.props.status !== "RUNNING") {
      throw new DomainError(`Run is ${this.props.status}; only RUNNING runs can fail`, "CONFLICT", 409);
    }
    this.log("ERROR", `Planning run failed: ${reason}`);
    this.props = { ...this.props, status: "FAILED", completedAt: nowIso(), failureReason: reason };
    this.raise(
      envelope({
        eventType: SupplyChainEvents.PlanningRunFailed,
        aggregateType: "PlanningRun",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { runId: this.id, reason },
      }),
    );
  }
}

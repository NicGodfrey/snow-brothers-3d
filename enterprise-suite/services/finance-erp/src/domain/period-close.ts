import {
  AggregateRoot,
  err,
  ok,
  nowIso,
  type IsoDateTime,
  type Result,
  type TenantId,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { newPeriodCloseRunId, type PeriodCloseRunId } from "./ids.js";

export type CloseCheckStatus = "PENDING" | "PASSED" | "FAILED";
export type CloseRunStatus = "IN_PROGRESS" | "READY" | "COMPLETED" | "CANCELLED";

export const CLOSE_CHECK_CODES = {
  NoDraftJournals: "no-draft-journals",
  SubledgersSettled: "subledgers-settled",
  TrialBalanceBalanced: "trial-balance-balanced",
} as const;

export type CloseCheckCode = (typeof CLOSE_CHECK_CODES)[keyof typeof CLOSE_CHECK_CODES];

export interface CloseCheck {
  readonly code: CloseCheckCode;
  readonly name: string;
  readonly status: CloseCheckStatus;
  readonly detail?: string;
  readonly evaluatedAt?: IsoDateTime;
}

export interface PeriodCloseRunProps {
  periodCode: string;
  status: CloseRunStatus;
  startedBy: UserId;
  checks: CloseCheck[];
  completedAt?: IsoDateTime;
  completedBy?: UserId;
}

const DEFAULT_CHECKS: readonly { code: CloseCheckCode; name: string }[] = [
  { code: CLOSE_CHECK_CODES.NoDraftJournals, name: "No draft journals dated in the period" },
  { code: CLOSE_CHECK_CODES.SubledgersSettled, name: "AR/AP documents in the period are posted to the GL" },
  { code: CLOSE_CHECK_CODES.TrialBalanceBalanced, name: "Trial balance debits equal credits" },
];

/**
 * A period close run tracks the checklist that gates flipping a PostingPeriod
 * from CLOSING to CLOSED. Checks are re-evaluated against live ledger state,
 * so a run can flip back from READY to IN_PROGRESS if a check regresses.
 */
export class PeriodCloseRun extends AggregateRoot<PeriodCloseRunProps> {
  private constructor(tenantId: TenantId, props: PeriodCloseRunProps, id?: PeriodCloseRunId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static start(tenantId: TenantId, periodCodeValue: string, startedBy: UserId): PeriodCloseRun {
    return new PeriodCloseRun(tenantId, {
      periodCode: periodCodeValue,
      status: "IN_PROGRESS",
      startedBy,
      checks: DEFAULT_CHECKS.map((c) => ({ ...c, status: "PENDING" as const })),
    }, newPeriodCloseRunId());
  }

  get periodCode(): string { return this.props.periodCode; }
  get status(): CloseRunStatus { return this.props.status; }
  get checks(): readonly CloseCheck[] { return this.props.checks; }

  recordCheck(code: CloseCheckCode, passed: boolean, detail?: string): Result<void> {
    if (this.props.status === "COMPLETED" || this.props.status === "CANCELLED") {
      return err(`close run for ${this.props.periodCode} is ${this.props.status}`);
    }
    const idx = this.props.checks.findIndex((c) => c.code === code);
    if (idx === -1) return err(`unknown close check "${code}"`);
    const checks = [...this.props.checks];
    checks[idx] = {
      ...checks[idx],
      status: passed ? "PASSED" : "FAILED",
      detail,
      evaluatedAt: nowIso(),
    };
    const allPassed = checks.every((c) => c.status === "PASSED");
    this.props = { ...this.props, checks, status: allPassed ? "READY" : "IN_PROGRESS" };
    this.touch();
    return ok(undefined);
  }

  complete(completedBy: UserId): Result<void> {
    if (this.props.status !== "READY") {
      const failing = this.props.checks
        .filter((c) => c.status !== "PASSED")
        .map((c) => `${c.code}=${c.status}`)
        .join(", ");
      return err(`close run is not READY (${failing || this.props.status})`);
    }
    this.props = { ...this.props, status: "COMPLETED", completedAt: nowIso(), completedBy };
    this.touch();
    return ok(undefined);
  }

  cancel(): Result<void> {
    if (this.props.status === "COMPLETED") {
      return err("a completed close run cannot be cancelled");
    }
    this.props = { ...this.props, status: "CANCELLED" };
    this.touch();
    return ok(undefined);
  }
}

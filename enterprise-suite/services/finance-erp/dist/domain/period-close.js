import { AggregateRoot, err, ok, nowIso, } from "@enterprise-suite/shared-kernel";
import { newPeriodCloseRunId } from "./ids.js";
export const CLOSE_CHECK_CODES = {
    NoDraftJournals: "no-draft-journals",
    SubledgersSettled: "subledgers-settled",
    TrialBalanceBalanced: "trial-balance-balanced",
};
const DEFAULT_CHECKS = [
    { code: CLOSE_CHECK_CODES.NoDraftJournals, name: "No draft journals dated in the period" },
    { code: CLOSE_CHECK_CODES.SubledgersSettled, name: "AR/AP documents in the period are posted to the GL" },
    { code: CLOSE_CHECK_CODES.TrialBalanceBalanced, name: "Trial balance debits equal credits" },
];
/**
 * A period close run tracks the checklist that gates flipping a PostingPeriod
 * from CLOSING to CLOSED. Checks are re-evaluated against live ledger state,
 * so a run can flip back from READY to IN_PROGRESS if a check regresses.
 */
export class PeriodCloseRun extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static start(tenantId, periodCodeValue, startedBy) {
        return new PeriodCloseRun(tenantId, {
            periodCode: periodCodeValue,
            status: "IN_PROGRESS",
            startedBy,
            checks: DEFAULT_CHECKS.map((c) => ({ ...c, status: "PENDING" })),
        }, newPeriodCloseRunId());
    }
    get periodCode() { return this.props.periodCode; }
    get status() { return this.props.status; }
    get checks() { return this.props.checks; }
    recordCheck(code, passed, detail) {
        if (this.props.status === "COMPLETED" || this.props.status === "CANCELLED") {
            return err(`close run for ${this.props.periodCode} is ${this.props.status}`);
        }
        const idx = this.props.checks.findIndex((c) => c.code === code);
        if (idx === -1)
            return err(`unknown close check "${code}"`);
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
    complete(completedBy) {
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
    cancel() {
        if (this.props.status === "COMPLETED") {
            return err("a completed close run cannot be cancelled");
        }
        this.props = { ...this.props, status: "CANCELLED" };
        this.touch();
        return ok(undefined);
    }
}
//# sourceMappingURL=period-close.js.map
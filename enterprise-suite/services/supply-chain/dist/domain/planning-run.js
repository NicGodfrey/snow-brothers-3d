import { AggregateRoot, DomainError, envelope, nowIso, } from "@enterprise-suite/shared-kernel";
import { SupplyChainEvents } from "./events.js";
import { assertIntInRange } from "./types.js";
function parseScope(input) {
    if (input === undefined || input === null)
        return { type: "ALL_ITEMS" };
    const raw = input;
    if (raw.type === "ALL_ITEMS")
        return { type: "ALL_ITEMS" };
    if (raw.type === "ITEMS") {
        if (!Array.isArray(raw.skus) || raw.skus.length === 0 || !raw.skus.every((s) => typeof s === "string" && s.trim())) {
            throw new DomainError("scope.skus must be a non-empty string array", "VALIDATION");
        }
        return { type: "ITEMS", skus: raw.skus.map((s) => s.trim().toUpperCase()) };
    }
    throw new DomainError("scope.type must be ALL_ITEMS or ITEMS", "VALIDATION");
}
/**
 * One execution of the MRP engine over a location and horizon. Lifecycle:
 * DRAFT -> RUNNING -> COMPLETED | FAILED. The audit log accumulates through
 * every phase and survives failure, which is precisely when it matters.
 */
export class PlanningRun extends AggregateRoot {
    static create(tenantId, input) {
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
    get status() {
        return this.props.status;
    }
    get location() {
        return this.props.location;
    }
    get horizonWeeks() {
        return this.props.horizonWeeks;
    }
    get scope() {
        return this.props.scope;
    }
    get audit() {
        return this.props.audit;
    }
    get stats() {
        return this.props.stats;
    }
    start() {
        if (this.props.status !== "DRAFT") {
            throw new DomainError(`Run is ${this.props.status}; only DRAFT runs can start`, "CONFLICT", 409);
        }
        this.props = { ...this.props, status: "RUNNING", startedAt: nowIso() };
        this.log("INFO", "Planning run started", {
            location: this.props.location,
            horizonWeeks: this.props.horizonWeeks,
            scope: this.props.scope,
        });
        this.raise(envelope({
            eventType: SupplyChainEvents.PlanningRunStarted,
            aggregateType: "PlanningRun",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { runId: this.id, location: this.props.location, horizonWeeks: this.props.horizonWeeks },
        }));
    }
    log(level, message, context) {
        if (this.props.status !== "RUNNING" && this.props.status !== "DRAFT") {
            throw new DomainError("Cannot append audit entries to a finished run", "CONFLICT", 409);
        }
        const entry = {
            seq: this.props.audit.length + 1,
            at: nowIso(),
            level,
            message,
            context: context ?? null,
        };
        this.props = { ...this.props, audit: [...this.props.audit, entry] };
    }
    complete(stats) {
        if (this.props.status !== "RUNNING") {
            throw new DomainError(`Run is ${this.props.status}; only RUNNING runs can complete`, "CONFLICT", 409);
        }
        this.log("INFO", "Planning run completed", { ...stats });
        this.props = { ...this.props, status: "COMPLETED", completedAt: nowIso(), stats };
        const payload = {
            runId: this.id,
            location: this.props.location,
            itemsPlanned: stats.itemsPlanned,
            ordersCreated: stats.ordersCreated,
            exceptionCount: stats.exceptionCount,
            levelsProcessed: stats.levelsProcessed,
        };
        this.raise(envelope({
            eventType: SupplyChainEvents.PlanningRunCompleted,
            aggregateType: "PlanningRun",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload,
        }));
    }
    fail(reason) {
        if (this.props.status !== "RUNNING") {
            throw new DomainError(`Run is ${this.props.status}; only RUNNING runs can fail`, "CONFLICT", 409);
        }
        this.log("ERROR", `Planning run failed: ${reason}`);
        this.props = { ...this.props, status: "FAILED", completedAt: nowIso(), failureReason: reason };
        this.raise(envelope({
            eventType: SupplyChainEvents.PlanningRunFailed,
            aggregateType: "PlanningRun",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { runId: this.id, reason },
        }));
    }
}
//# sourceMappingURL=planning-run.js.map
import { AggregateRoot, type IsoDateTime, type TenantId } from "@enterprise-suite/shared-kernel";
import { type LocationCode } from "./types.js";
export type PlanningRunStatus = "DRAFT" | "RUNNING" | "COMPLETED" | "FAILED";
export type PlanningScope = {
    readonly type: "ALL_ITEMS";
} | {
    readonly type: "ITEMS";
    readonly skus: readonly string[];
};
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
/**
 * One execution of the MRP engine over a location and horizon. Lifecycle:
 * DRAFT -> RUNNING -> COMPLETED | FAILED. The audit log accumulates through
 * every phase and survives failure, which is precisely when it matters.
 */
export declare class PlanningRun extends AggregateRoot<PlanningRunProps> {
    static create(tenantId: TenantId, input: {
        name?: string;
        location: LocationCode;
        horizonWeeks: number;
        scope?: unknown;
    }): PlanningRun;
    get status(): PlanningRunStatus;
    get location(): LocationCode;
    get horizonWeeks(): number;
    get scope(): PlanningScope;
    get audit(): readonly AuditEntry[];
    get stats(): PlanningRunStats | null;
    start(): void;
    log(level: AuditLevel, message: string, context?: Record<string, unknown>): void;
    complete(stats: PlanningRunStats): void;
    fail(reason: string): void;
}
export {};
//# sourceMappingURL=planning-run.d.ts.map
import { AggregateRoot, type TenantId } from "@enterprise-suite/shared-kernel";
/**
 * Safety stock methods:
 *
 * - STATIC         fixed quantity maintained regardless of demand
 * - DAYS_OF_COVER  average daily demand x coverage days
 * - SERVICE_LEVEL  z(serviceLevel) x sigma_weekly x sqrt(leadTime in weeks),
 *                  the classic statistical formula for demand variability
 *                  over the replenishment lead time
 */
export type SafetyStockMethod = {
    readonly type: "STATIC";
    readonly qty: number;
} | {
    readonly type: "DAYS_OF_COVER";
    readonly days: number;
} | {
    readonly type: "SERVICE_LEVEL";
    /** Cycle service level, e.g. 0.95. Must be in (0.5, 0.9999]. */
    readonly serviceLevel: number;
    /** Optional override; when absent it is derived from the demand series. */
    readonly weeklyDemandStdDev?: number;
};
export declare function parseSafetyStockMethod(input: unknown): SafetyStockMethod;
/**
 * Inverse standard normal CDF (probit) via Acklam's rational approximation.
 * Absolute error < 1.15e-9 over the open interval (0, 1) — more than enough
 * precision for service-level z-factors.
 */
export declare function inverseNormalCdf(p: number): number;
/** Sample standard deviation of a weekly demand series. */
export declare function weeklyStdDev(series: readonly number[]): number;
export interface SafetyStockContext {
    /** Average demand per week over the planning horizon. */
    readonly avgWeeklyDemand: number;
    /** Standard deviation of weekly demand (used when the policy has no override). */
    readonly weeklyDemandStdDev: number;
    readonly leadTimeDays: number;
}
export declare function computeSafetyStock(method: SafetyStockMethod, ctx: SafetyStockContext): number;
interface SafetyStockPolicyProps {
    name: string;
    description: string | null;
    method: SafetyStockMethod;
}
/**
 * Named, reusable safety stock policy. Items reference a policy by id so a
 * planner can retune coverage for a whole segment (e.g. "A items 98% SL")
 * in one place.
 */
export declare class SafetyStockPolicy extends AggregateRoot<SafetyStockPolicyProps> {
    static create(tenantId: TenantId, input: {
        name: string;
        description?: string;
        method: SafetyStockMethod;
    }): SafetyStockPolicy;
    get name(): string;
    get method(): SafetyStockMethod;
    changeMethod(method: SafetyStockMethod): void;
    rename(name: string): void;
    compute(ctx: SafetyStockContext): number;
    private raiseChanged;
}
export {};
//# sourceMappingURL=safety-stock.d.ts.map
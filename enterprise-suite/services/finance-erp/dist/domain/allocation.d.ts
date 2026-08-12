import { AggregateRoot, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
import { type AccountId, type CostCenterId } from "./ids.js";
export interface AllocationTarget {
    readonly costCenterId: CostCenterId;
    readonly percentBps: number;
}
export interface AllocationRuleProps {
    name: string;
    description?: string;
    /** Costs are pulled from this (account, cost center) pair... */
    sourceAccountId: AccountId;
    sourceCostCenterId: CostCenterId;
    /** ...and pushed to these cost centers on the same account, split by basis points. */
    targets: AllocationTarget[];
    active: boolean;
}
export declare class AllocationRule extends AggregateRoot<AllocationRuleProps> {
    private constructor();
    static create(tenantId: TenantId, input: {
        name: string;
        description?: string;
        sourceAccountId: AccountId;
        sourceCostCenterId: CostCenterId;
        targets: AllocationTarget[];
    }): Result<AllocationRule>;
    get name(): string;
    get sourceAccountId(): AccountId;
    get sourceCostCenterId(): CostCenterId;
    get targets(): readonly AllocationTarget[];
    get active(): boolean;
    deactivate(): Result<void>;
    /**
     * Splits an amount across targets by basis points using integer arithmetic.
     * Rounding remainders are pushed onto the final target so the split always
     * sums exactly to the source amount.
     */
    split(amountMinor: number): {
        costCenterId: CostCenterId;
        amountMinor: number;
    }[];
}
//# sourceMappingURL=allocation.d.ts.map
import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { AllocationRule } from "../domain/allocation.js";
import type { AllocationRuleId } from "../domain/ids.js";
import type { Journal } from "../domain/journal.js";
import type { AccountRepository, AllocationRuleRepository, CostCenterRepository, JournalRepository, PeriodRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import type { JournalService } from "./journal-service.js";
export interface CreateAllocationRuleCommand {
    name: string;
    description?: string;
    sourceAccountCode: string;
    sourceCostCenterCode: string;
    targets: {
        costCenterCode: string;
        percentBps: number;
    }[];
}
export interface AllocationRunResult {
    ruleId: AllocationRuleId;
    ruleName: string;
    periodCode: string;
    sourceAmountMinor: number;
    journal?: ReturnType<Journal["toJSON"]>;
    splits: {
        costCenterCode: string;
        amountMinor: number;
    }[];
    skipped: boolean;
    reason?: string;
}
/**
 * Simple cost allocations: a rule drains the net cost sitting on one
 * (account, cost center) pair for a period and redistributes it across
 * target cost centers by fixed percentages, via a normal GL journal.
 */
export declare class AllocationService {
    private readonly rules;
    private readonly accounts;
    private readonly costCenters;
    private readonly journals;
    private readonly periods;
    private readonly journalService;
    private readonly outbox;
    constructor(rules: AllocationRuleRepository, accounts: AccountRepository, costCenters: CostCenterRepository, journals: JournalRepository, periods: PeriodRepository, journalService: JournalService, outbox: EventOutbox);
    createRule(ctx: TenantContext, command: CreateAllocationRuleCommand): Promise<AllocationRule>;
    getRule(ctx: TenantContext, id: AllocationRuleId): Promise<AllocationRule>;
    listRules(ctx: TenantContext): Promise<AllocationRule[]>;
    deactivateRule(ctx: TenantContext, id: AllocationRuleId): Promise<AllocationRule>;
    /**
     * Executes a rule for a period. The allocation journal credits the source
     * cost center and debits each target on the same expense account, keeping
     * the account total unchanged while moving cost between centers.
     */
    runRule(ctx: TenantContext, ruleId: AllocationRuleId, periodCodeValue: string): Promise<AllocationRunResult>;
}
//# sourceMappingURL=allocation-service.d.ts.map
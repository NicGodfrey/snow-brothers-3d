import {
  ConflictError,
  DomainError,
  NotFoundError,
  envelope,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { AllocationRule, type AllocationTarget } from "../domain/allocation.js";
import { FinanceEventTypes, type AllocationExecutedPayload } from "../domain/events.js";
import type { AllocationRuleId } from "../domain/ids.js";
import type { Journal } from "../domain/journal.js";
import type {
  AccountRepository,
  AllocationRuleRepository,
  CostCenterRepository,
  JournalRepository,
  PeriodRepository,
} from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";
import type { JournalLineCommand, JournalService } from "./journal-service.js";

export interface CreateAllocationRuleCommand {
  name: string;
  description?: string;
  sourceAccountCode: string;
  sourceCostCenterCode: string;
  targets: { costCenterCode: string; percentBps: number }[];
}

export interface AllocationRunResult {
  ruleId: AllocationRuleId;
  ruleName: string;
  periodCode: string;
  sourceAmountMinor: number;
  journal?: ReturnType<Journal["toJSON"]>;
  splits: { costCenterCode: string; amountMinor: number }[];
  skipped: boolean;
  reason?: string;
}

/**
 * Simple cost allocations: a rule drains the net cost sitting on one
 * (account, cost center) pair for a period and redistributes it across
 * target cost centers by fixed percentages, via a normal GL journal.
 */
export class AllocationService {
  constructor(
    private readonly rules: AllocationRuleRepository,
    private readonly accounts: AccountRepository,
    private readonly costCenters: CostCenterRepository,
    private readonly journals: JournalRepository,
    private readonly periods: PeriodRepository,
    private readonly journalService: JournalService,
    private readonly outbox: EventOutbox,
  ) {}

  async createRule(ctx: TenantContext, command: CreateAllocationRuleCommand): Promise<AllocationRule> {
    const account = await this.accounts.findByCode(ctx.tenantId, command.sourceAccountCode);
    if (!account) throw new NotFoundError("Account", command.sourceAccountCode);
    if (account.type !== "EXPENSE") {
      throw new ConflictError(
        `allocation source account ${account.code} is ${account.type}; only EXPENSE accounts can be allocated`,
      );
    }
    const sourceCc = await this.costCenters.findByCode(
      ctx.tenantId,
      command.sourceCostCenterCode.toUpperCase(),
    );
    if (!sourceCc) throw new NotFoundError("CostCenter", command.sourceCostCenterCode);

    const targets: AllocationTarget[] = [];
    for (const target of command.targets) {
      const cc = await this.costCenters.findByCode(ctx.tenantId, target.costCenterCode.toUpperCase());
      if (!cc) throw new NotFoundError("CostCenter", target.costCenterCode);
      targets.push({ costCenterId: cc.id, percentBps: target.percentBps });
    }

    const rule = expectOk(AllocationRule.create(ctx.tenantId, {
      name: command.name,
      description: command.description,
      sourceAccountId: account.id,
      sourceCostCenterId: sourceCc.id,
      targets,
    }));
    await this.rules.save(rule);
    return rule;
  }

  async getRule(ctx: TenantContext, id: AllocationRuleId): Promise<AllocationRule> {
    const rule = await this.rules.findById(ctx.tenantId, id);
    if (!rule) throw new NotFoundError("AllocationRule", id);
    return rule;
  }

  async listRules(ctx: TenantContext): Promise<AllocationRule[]> {
    return this.rules.list(ctx.tenantId);
  }

  async deactivateRule(ctx: TenantContext, id: AllocationRuleId): Promise<AllocationRule> {
    const rule = await this.getRule(ctx, id);
    expectOk(rule.deactivate());
    await this.rules.save(rule);
    return rule;
  }

  /**
   * Executes a rule for a period. The allocation journal credits the source
   * cost center and debits each target on the same expense account, keeping
   * the account total unchanged while moving cost between centers.
   */
  async runRule(ctx: TenantContext, ruleId: AllocationRuleId, periodCodeValue: string): Promise<AllocationRunResult> {
    const rule = await this.getRule(ctx, ruleId);
    if (!rule.active) {
      throw new ConflictError(`allocation rule "${rule.name}" is inactive`);
    }
    const period = await this.periods.findByCode(ctx.tenantId, periodCodeValue);
    if (!period) throw new NotFoundError("PostingPeriod", periodCodeValue);
    if (period.status === "CLOSED") {
      throw new DomainError(
        `period ${period.code} is CLOSED; allocations require OPEN or CLOSING`,
        "PERIOD_NOT_OPEN",
        422,
      );
    }

    const account = await this.accounts.findById(ctx.tenantId, rule.sourceAccountId);
    if (!account) throw new NotFoundError("Account", rule.sourceAccountId);
    const sourceCc = await this.costCenters.findById(ctx.tenantId, rule.sourceCostCenterId);
    if (!sourceCc) throw new NotFoundError("CostCenter", rule.sourceCostCenterId);

    // Net posted cost on (source account, source cost center) within the period.
    const journals = await this.journals.listByDateRange(
      ctx.tenantId,
      period.startDate,
      period.endDate,
    );
    let sourceAmount = 0;
    for (const journal of journals) {
      if (journal.status !== "POSTED" && journal.status !== "REVERSED") continue;
      for (const line of journal.lines) {
        if (line.accountId !== rule.sourceAccountId) continue;
        if (line.costCenterId !== rule.sourceCostCenterId) continue;
        sourceAmount += line.debitMinor - line.creditMinor;
      }
    }

    const base: Omit<AllocationRunResult, "splits" | "skipped"> = {
      ruleId: rule.id,
      ruleName: rule.name,
      periodCode: period.code,
      sourceAmountMinor: sourceAmount,
    };
    if (sourceAmount <= 0) {
      return {
        ...base,
        splits: [],
        skipped: true,
        reason: `nothing to allocate: net cost is ${sourceAmount}`,
      };
    }

    const splits = rule.split(sourceAmount);
    const splitOut: { costCenterCode: string; amountMinor: number }[] = [];
    const lines: JournalLineCommand[] = [{
      accountId: account.id,
      costCenterId: sourceCc.id,
      creditMinor: sourceAmount,
      description: `Allocation "${rule.name}" out of ${sourceCc.code}`,
    }];
    for (const split of splits) {
      const targetCc = await this.costCenters.findById(ctx.tenantId, split.costCenterId);
      if (!targetCc) throw new NotFoundError("CostCenter", split.costCenterId);
      lines.push({
        accountId: account.id,
        costCenterId: split.costCenterId,
        debitMinor: split.amountMinor,
        description: `Allocation "${rule.name}" into ${targetCc.code}`,
      });
      splitOut.push({ costCenterCode: targetCc.code, amountMinor: split.amountMinor });
    }

    const journal = await this.journalService.createAndPost(ctx, {
      journalDate: period.endDate,
      currency: account.currency,
      source: "ALLOCATION",
      memo: `Allocation "${rule.name}" for ${period.code}`,
      lines,
    });

    const payload: AllocationExecutedPayload = {
      ruleId: rule.id,
      ruleName: rule.name,
      periodCode: period.code,
      sourceAmountMinor: sourceAmount,
      journalId: journal.id,
      targetCount: splits.length,
    };
    this.outbox.publish(envelope({
      eventType: FinanceEventTypes.AllocationExecuted,
      aggregateType: "AllocationRule",
      aggregateId: rule.id,
      tenantId: ctx.tenantId,
      payload,
    }));

    return {
      ...base,
      journal: journal.toJSON(),
      splits: splitOut,
      skipped: false,
    };
  }
}

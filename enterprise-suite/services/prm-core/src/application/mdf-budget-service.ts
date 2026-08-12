import {
  ConflictError,
  NotFoundError,
  addMoney,
  money,
  normalizePage,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { InvalidStateError } from "../domain/errors.js";
import { MdfBudget, type CreateMdfBudgetInput, type MdfAllocation } from "../domain/mdf-budget.js";
import { subtract } from "../domain/money.js";
import type {
  Clock,
  MdfBudgetFilter,
  MdfBudgetRepository,
  OutboxPort,
  PartnerRepository,
} from "./ports.js";

export interface AllocateFundsCommand {
  readonly partnerId: Ulid;
  readonly amount: Money;
  readonly note?: string;
}

export interface PartnerFundsBalance {
  readonly partnerId: Ulid;
  readonly currency: string;
  readonly allocated: Money;
  readonly committed: Money;
  readonly paid: Money;
  readonly available: Money;
  readonly budgets: readonly {
    readonly budgetId: Ulid;
    readonly code: string;
    readonly period: string;
    readonly allocationId: Ulid;
    readonly allocated: Money;
    readonly committed: Money;
    readonly paid: Money;
    readonly available: Money;
  }[];
}

/**
 * MDF budget administration: create the pot, open it, carve allocations, and
 * report balances. The commit/settle side of the ledger is driven by the fund
 * request and claim workflows in MdfService; this service owns the money that
 * has not been spoken for yet.
 */
export class MdfBudgetService {
  constructor(
    private readonly budgets: MdfBudgetRepository,
    private readonly partners: PartnerRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, input: CreateMdfBudgetInput): Promise<MdfBudget> {
    const existing = await this.budgets.byCode(ctx.tenantId, input.code);
    if (existing) throw new ConflictError(`Budget "${existing.code}" already exists`);
    const budget = MdfBudget.create(ctx.tenantId, input);
    await this.commit(budget);
    return budget;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<MdfBudget> {
    const budget = await this.budgets.byId(ctx.tenantId, id);
    if (!budget) throw new NotFoundError("MdfBudget", id);
    return budget;
  }

  async byCode(ctx: TenantContext, code: string): Promise<MdfBudget> {
    const budget = await this.budgets.byCode(ctx.tenantId, code);
    if (!budget) throw new NotFoundError("MdfBudget", code);
    return budget;
  }

  async list(ctx: TenantContext, filter: MdfBudgetFilter, page?: Partial<PageRequest>): Promise<Page<MdfBudget>> {
    return this.budgets.list(ctx.tenantId, filter, normalizePage(page));
  }

  async open(ctx: TenantContext, id: Ulid): Promise<MdfBudget> {
    const budget = await this.get(ctx, id);
    budget.open(this.clock.now());
    await this.commit(budget);
    return budget;
  }

  async topUp(ctx: TenantContext, id: Ulid, amount: Money, reason: string): Promise<MdfBudget> {
    const budget = await this.get(ctx, id);
    budget.topUp(amount, reason);
    await this.commit(budget);
    return budget;
  }

  async close(ctx: TenantContext, id: Ulid): Promise<MdfBudget> {
    const budget = await this.get(ctx, id);
    budget.close(this.clock.now(), ctx.userId);
    await this.commit(budget);
    return budget;
  }

  /** Carves out a partner's share of the pot. */
  async allocate(ctx: TenantContext, id: Ulid, command: AllocateFundsCommand): Promise<MdfAllocation> {
    const budget = await this.get(ctx, id);
    const partner = await this.partners.byId(ctx.tenantId, command.partnerId);
    if (!partner) throw new NotFoundError("Partner", command.partnerId);
    if (partner.status !== "active" && partner.status !== "approved") {
      throw new InvalidStateError(`${partner.number} is ${partner.status} and cannot receive MDF`);
    }
    if (partner.currency !== budget.currency) {
      throw new InvalidStateError(
        `${partner.number} reports in ${partner.currency} but budget ${budget.code} is ${budget.currency}`,
      );
    }
    const allocation = budget.allocate({ ...command, at: this.clock.now() });
    await this.commit(budget);
    return allocation;
  }

  async adjustAllocation(
    ctx: TenantContext,
    id: Ulid,
    allocationId: Ulid,
    amount: Money,
    reason: string,
  ): Promise<MdfAllocation> {
    const budget = await this.get(ctx, id);
    const allocation = budget.adjustAllocation(allocationId, amount, reason);
    await this.commit(budget);
    return allocation;
  }

  /** Cross-budget funds statement for one partner, in the partner's currency. */
  async partnerBalance(ctx: TenantContext, partnerId: Ulid): Promise<PartnerFundsBalance> {
    const partner = await this.partners.byId(ctx.tenantId, partnerId);
    if (!partner) throw new NotFoundError("Partner", partnerId);
    const budgets = await this.budgets.all(ctx.tenantId);
    const rows: PartnerFundsBalance["budgets"][number][] = [];
    let allocated = money(0, partner.currency);
    let committed = money(0, partner.currency);
    let paid = money(0, partner.currency);

    for (const budget of budgets) {
      if (budget.currency !== partner.currency) continue;
      const allocation = budget.allocationForPartner(partnerId);
      if (!allocation) continue;
      const available = subtract(allocation.amount, addMoney(allocation.committed, allocation.paid));
      rows.push({
        budgetId: budget.id,
        code: budget.code,
        period: budget.period,
        allocationId: allocation.id,
        allocated: allocation.amount,
        committed: allocation.committed,
        paid: allocation.paid,
        available,
      });
      allocated = addMoney(allocated, allocation.amount);
      committed = addMoney(committed, allocation.committed);
      paid = addMoney(paid, allocation.paid);
    }
    return {
      partnerId,
      currency: partner.currency,
      allocated,
      committed,
      paid,
      available: subtract(allocated, addMoney(committed, paid)),
      budgets: rows.sort((a, b) => a.period.localeCompare(b.period)),
    };
  }

  private async commit(budget: MdfBudget): Promise<void> {
    await this.budgets.save(budget);
    await this.outbox.publish(budget.pullEvents());
  }
}

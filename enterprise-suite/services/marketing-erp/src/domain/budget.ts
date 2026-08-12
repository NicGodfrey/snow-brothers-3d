import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  money,
  newId,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  MarketingEvents,
  type BudgetThresholdBreachedPayload,
  type SpendRecordedPayload,
} from "./events.js";

export const SPEND_CATEGORIES = [
  "media",
  "agency",
  "content",
  "tools",
  "events",
  "other",
] as const;
export type SpendCategory = (typeof SPEND_CATEGORIES)[number];

export function assertSpendCategory(value: string): SpendCategory {
  if (!(SPEND_CATEGORIES as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown spend category: ${value}`, "BUDGET_INVALID_CATEGORY");
  }
  return value as SpendCategory;
}

export interface SpendEntry {
  readonly entryId: Ulid;
  readonly channelId?: Ulid;
  readonly category: SpendCategory;
  readonly amount: Money;
  readonly occurredAt: IsoDateTime;
  readonly note?: string;
}

export interface CampaignBudgetProps {
  campaignId: Ulid;
  total: Money;
  entries: SpendEntry[];
  /** Utilization ratio at which a warning event fires (e.g. 0.8 = 80%). */
  warnThreshold: number;
  /** When true, spend may exceed the budget (flagged, not blocked). */
  allowOverspend: boolean;
  thresholdBreachedAt?: IsoDateTime;
}

/**
 * One budget per campaign. Spend entries are append-only; adjustments change
 * the ceiling, never the history.
 */
export class CampaignBudget extends AggregateRoot<CampaignBudgetProps> {
  private constructor(tenantId: TenantId, props: CampaignBudgetProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static create(input: {
    tenantId: TenantId;
    campaignId: Ulid;
    total: Money;
    warnThreshold?: number;
    allowOverspend?: boolean;
  }): CampaignBudget {
    if (input.total.amountMinor <= 0) {
      throw new DomainError("Budget total must be positive", "BUDGET_INVALID_TOTAL");
    }
    const warnThreshold = input.warnThreshold ?? 0.8;
    if (warnThreshold <= 0 || warnThreshold > 1) {
      throw new DomainError("warnThreshold must be in (0, 1]", "BUDGET_INVALID_THRESHOLD");
    }
    const budget = new CampaignBudget(input.tenantId, {
      campaignId: input.campaignId,
      total: input.total,
      entries: [],
      warnThreshold,
      allowOverspend: input.allowOverspend ?? false,
    });
    budget.raise(
      envelope({
        eventType: MarketingEvents.BudgetCreated,
        aggregateType: "CampaignBudget",
        aggregateId: budget.id,
        tenantId: budget.tenantId,
        payload: { budgetId: budget.id, campaignId: input.campaignId, total: input.total },
      }),
    );
    return budget;
  }

  get campaignId(): Ulid {
    return this.props.campaignId;
  }

  get total(): Money {
    return this.props.total;
  }

  get entries(): readonly SpendEntry[] {
    return this.props.entries;
  }

  get currency(): string {
    return this.props.total.currency;
  }

  totalSpend(): Money {
    const sum = this.props.entries.reduce((acc, e) => acc + e.amount.amountMinor, 0);
    return money(sum, this.props.total.currency);
  }

  remaining(): Money {
    return money(this.props.total.amountMinor - this.totalSpend().amountMinor, this.currency);
  }

  /** Spend as a fraction of budget; can exceed 1 when overspend is allowed. */
  utilization(): number {
    return this.totalSpend().amountMinor / this.props.total.amountMinor;
  }

  spendByChannel(): ReadonlyMap<string, Money> {
    const map = new Map<string, number>();
    for (const entry of this.props.entries) {
      const key = entry.channelId ?? "cross-channel";
      map.set(key, (map.get(key) ?? 0) + entry.amount.amountMinor);
    }
    return new Map([...map.entries()].map(([k, v]) => [k, money(v, this.currency)]));
  }

  spendByCategory(): ReadonlyMap<SpendCategory, Money> {
    const map = new Map<SpendCategory, number>();
    for (const entry of this.props.entries) {
      map.set(entry.category, (map.get(entry.category) ?? 0) + entry.amount.amountMinor);
    }
    return new Map([...map.entries()].map(([k, v]) => [k, money(v, this.currency)]));
  }

  recordSpend(input: {
    amount: Money;
    category: SpendCategory;
    occurredAt: IsoDateTime;
    channelId?: Ulid;
    note?: string;
  }): SpendEntry {
    if (input.amount.currency !== this.currency) {
      throw new DomainError(
        `Spend currency ${input.amount.currency} does not match budget currency ${this.currency}`,
        "BUDGET_CURRENCY_MISMATCH",
      );
    }
    if (input.amount.amountMinor <= 0) {
      throw new DomainError("Spend amount must be positive", "BUDGET_INVALID_SPEND");
    }
    const projected = this.totalSpend().amountMinor + input.amount.amountMinor;
    if (!this.props.allowOverspend && projected > this.props.total.amountMinor) {
      throw new ConflictError(
        `Spend would exceed budget: ${projected} > ${this.props.total.amountMinor} minor units`,
      );
    }

    const utilizationBefore = this.utilization();
    const entry: SpendEntry = {
      entryId: newId("spend"),
      channelId: input.channelId,
      category: input.category,
      amount: input.amount,
      occurredAt: input.occurredAt,
      note: input.note,
    };
    this.props.entries.push(entry);

    this.raise(
      envelope<SpendRecordedPayload>({
        eventType: MarketingEvents.SpendRecorded,
        aggregateType: "CampaignBudget",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          budgetId: this.id,
          campaignId: this.props.campaignId,
          channelId: input.channelId,
          category: input.category,
          amount: input.amount,
          totalSpend: this.totalSpend(),
        },
      }),
    );

    const utilizationAfter = this.utilization();
    if (utilizationBefore < this.props.warnThreshold && utilizationAfter >= this.props.warnThreshold) {
      this.props.thresholdBreachedAt = input.occurredAt;
      this.raise(
        envelope<BudgetThresholdBreachedPayload>({
          eventType: MarketingEvents.BudgetThresholdBreached,
          aggregateType: "CampaignBudget",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            budgetId: this.id,
            campaignId: this.props.campaignId,
            utilization: utilizationAfter,
            threshold: this.props.warnThreshold,
          },
        }),
      );
    }
    return entry;
  }

  /** Raise or lower the ceiling. Lowering below recorded spend requires allowOverspend. */
  adjustTotal(newTotal: Money, reason: string): void {
    if (newTotal.currency !== this.currency) {
      throw new DomainError("Cannot change budget currency", "BUDGET_CURRENCY_MISMATCH");
    }
    if (newTotal.amountMinor <= 0) {
      throw new DomainError("Budget total must be positive", "BUDGET_INVALID_TOTAL");
    }
    if (!this.props.allowOverspend && newTotal.amountMinor < this.totalSpend().amountMinor) {
      throw new ConflictError("New budget total is below already-recorded spend");
    }
    const previous = this.props.total;
    this.props.total = newTotal;
    this.raise(
      envelope({
        eventType: MarketingEvents.BudgetAdjusted,
        aggregateType: "CampaignBudget",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { budgetId: this.id, previousTotal: previous, total: newTotal, reason },
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// ROI math — pure functions shared by rollup services and reports.
// ---------------------------------------------------------------------------

export interface RoiInput {
  readonly spendMinor: number;
  readonly attributedRevenueMinor: number;
  readonly leads: number;
  readonly conversions: number;
}

export interface RoiMetrics {
  readonly spendMinor: number;
  readonly attributedRevenueMinor: number;
  readonly leads: number;
  readonly conversions: number;
  /** (revenue - spend) / spend; null when spend is zero. */
  readonly roi: number | null;
  /** revenue / spend; null when spend is zero. */
  readonly roas: number | null;
  /** Cost per lead in minor units; null when there are no leads. */
  readonly costPerLeadMinor: number | null;
  /** Cost per conversion in minor units; null when there are no conversions. */
  readonly costPerAcquisitionMinor: number | null;
  /** conversions / leads; null when there are no leads. */
  readonly conversionRate: number | null;
}

export function computeRoiMetrics(input: RoiInput): RoiMetrics {
  const { spendMinor, attributedRevenueMinor, leads, conversions } = input;
  if (spendMinor < 0 || attributedRevenueMinor < 0 || leads < 0 || conversions < 0) {
    throw new DomainError("ROI inputs cannot be negative", "ROI_INVALID_INPUT");
  }
  return {
    spendMinor,
    attributedRevenueMinor,
    leads,
    conversions,
    roi: spendMinor === 0 ? null : (attributedRevenueMinor - spendMinor) / spendMinor,
    roas: spendMinor === 0 ? null : attributedRevenueMinor / spendMinor,
    costPerLeadMinor: leads === 0 ? null : Math.round(spendMinor / leads),
    costPerAcquisitionMinor: conversions === 0 ? null : Math.round(spendMinor / conversions),
    conversionRate: leads === 0 ? null : conversions / leads,
  };
}

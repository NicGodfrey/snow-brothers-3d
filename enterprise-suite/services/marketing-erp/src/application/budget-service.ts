import {
  brand,
  ConflictError,
  DomainError,
  money,
  type IsoDateTime,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { assertAttributionModel } from "../domain/attribution.js";
import {
  assertSpendCategory,
  CampaignBudget,
  computeRoiMetrics,
  type SpendEntry,
} from "../domain/budget.js";
import type { CampaignRoiDto, PortfolioRoiDto } from "./dto.js";
import type { AttributionService } from "./attribution-service.js";
import type { BudgetRepository, CampaignRepository, Clock, OutboxPort } from "./ports.js";

export interface CreateBudgetInput {
  campaignId: string;
  totalMinor: number;
  currency: string;
  warnThreshold?: number;
  allowOverspend?: boolean;
}

export interface RecordSpendInput {
  amountMinor: number;
  currency: string;
  category: string;
  channelId?: string;
  occurredAt?: string;
  note?: string;
}

export class BudgetService {
  constructor(
    private readonly budgets: BudgetRepository,
    private readonly campaigns: CampaignRepository,
    private readonly attribution: AttributionService,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  private persist(budget: CampaignBudget): CampaignBudget {
    this.budgets.save(budget);
    this.outbox.publish(budget.pullEvents());
    return budget;
  }

  create(ctx: TenantContext, input: CreateBudgetInput): CampaignBudget {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, input.campaignId);
    if (this.budgets.findByCampaign(ctx.tenantId, campaign.id)) {
      throw new ConflictError(`Campaign already has a budget: ${campaign.code}`);
    }
    const budget = CampaignBudget.create({
      tenantId: ctx.tenantId,
      campaignId: campaign.id,
      total: money(input.totalMinor, input.currency),
      warnThreshold: input.warnThreshold,
      allowOverspend: input.allowOverspend,
    });
    return this.persist(budget);
  }

  get(ctx: TenantContext, id: string): CampaignBudget {
    return this.budgets.getOrThrow(ctx.tenantId, id);
  }

  forCampaign(ctx: TenantContext, campaignId: string): CampaignBudget | undefined {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, campaignId);
    return this.budgets.findByCampaign(ctx.tenantId, campaign.id);
  }

  recordSpend(ctx: TenantContext, budgetId: string, input: RecordSpendInput): SpendEntry {
    const budget = this.budgets.getOrThrow(ctx.tenantId, budgetId);
    let occurredAt: IsoDateTime;
    if (input.occurredAt !== undefined) {
      const ms = Date.parse(input.occurredAt);
      if (Number.isNaN(ms)) {
        throw new DomainError(
          `occurredAt is not a valid ISO date-time: ${input.occurredAt}`,
          "INVALID_DATE",
        );
      }
      occurredAt = brand<string, "IsoDateTime">(new Date(ms).toISOString());
    } else {
      occurredAt = this.clock.nowIso();
    }
    const entry = budget.recordSpend({
      amount: money(input.amountMinor, input.currency),
      category: assertSpendCategory(input.category),
      occurredAt,
      channelId: input.channelId as SpendEntry["channelId"],
      note: input.note,
    });
    this.persist(budget);
    return entry;
  }

  adjustTotal(ctx: TenantContext, budgetId: string, totalMinor: number, currency: string, reason: string): CampaignBudget {
    const budget = this.budgets.getOrThrow(ctx.tenantId, budgetId);
    budget.adjustTotal(money(totalMinor, currency), reason);
    return this.persist(budget);
  }

  /**
   * ROI rollup for one campaign: spend from its budget, revenue from the
   * chosen attribution model, lead/conversion counts from touchpoints.
   */
  campaignRoi(ctx: TenantContext, campaignId: string, model: string): CampaignRoiDto {
    const campaign = this.campaigns.getOrThrow(ctx.tenantId, campaignId);
    const budget = this.budgets.findByCampaign(ctx.tenantId, campaign.id);
    const performance = this.attribution.campaignPerformance(ctx, campaign.id, model);

    const spendMinor = budget?.totalSpend().amountMinor ?? 0;
    const metrics = computeRoiMetrics({
      spendMinor,
      attributedRevenueMinor: performance.attributedRevenueMinor,
      leads: performance.touchedLeads,
      conversions: performance.convertedLeads,
    });
    return {
      campaignId: campaign.id,
      campaignCode: campaign.code,
      model: performance.model,
      currency: budget?.currency ?? performance.currency,
      budgetTotalMinor: budget?.total.amountMinor ?? 0,
      spendMinor,
      remainingMinor: budget?.remaining().amountMinor ?? 0,
      utilization: budget?.utilization() ?? 0,
      attributedRevenueMinor: metrics.attributedRevenueMinor,
      leads: metrics.leads,
      conversions: metrics.conversions,
      roi: metrics.roi,
      roas: metrics.roas,
      costPerLeadMinor: metrics.costPerLeadMinor,
      costPerAcquisitionMinor: metrics.costPerAcquisitionMinor,
      conversionRate: metrics.conversionRate,
    };
  }

  /** Portfolio rollup across every campaign that has a budget. */
  portfolioRoi(ctx: TenantContext, model: string): PortfolioRoiDto {
    const parsedModel = assertAttributionModel(model);
    const campaignDtos = this.budgets
      .list(ctx.tenantId)
      .map((budget) => this.campaignRoi(ctx, budget.campaignId, parsedModel))
      .sort((a, b) => (b.attributedRevenueMinor ?? 0) - (a.attributedRevenueMinor ?? 0));

    const spendMinor = campaignDtos.reduce((sum, c) => sum + c.spendMinor, 0);
    const attributedRevenueMinor = campaignDtos.reduce(
      (sum, c) => sum + c.attributedRevenueMinor,
      0,
    );
    return {
      model: parsedModel,
      currency: campaignDtos[0]?.currency ?? "USD",
      campaigns: campaignDtos,
      totals: {
        spendMinor,
        attributedRevenueMinor,
        roi: spendMinor === 0 ? null : (attributedRevenueMinor - spendMinor) / spendMinor,
        roas: spendMinor === 0 ? null : attributedRevenueMinor / spendMinor,
      },
    };
  }
}

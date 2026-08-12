import type { IsoDateTime, TenantContext, Ulid } from "@enterprise-suite/shared-kernel";
import type { ChannelOrder } from "../domain/channel-order.js";
import type { DealRegistration } from "../domain/deal-registration.js";
import type { PartnerTier } from "../domain/partner.js";
import type { Referral } from "../domain/referral.js";
import {
  channelFunnel,
  cohortReport,
  forecastRollup,
  partnerScorecards,
  pipelineByPartner,
  pipelineByStage,
  pipelineByTier,
  protectionExpiryReport,
  slippedDeals,
  sourcedVsInfluenced,
  stalledDeals,
  type ChannelFunnel,
  type Cohort,
  type CohortGranularity,
  type ExpiryReport,
  type ForecastBucket,
  type PartnerPipelineReport,
  type PartnerScorecard,
  type PipelineDeal,
  type PipelineOrder,
  type PipelineReferral,
  type SourceSplit,
  type StagePipeline,
  type StalledDeal,
  type TierBucket,
} from "../domain/pipeline.js";
import type {
  ChannelOrderRepository,
  Clock,
  ConflictRepository,
  PartnerRepository,
  ReferralRepository,
  RegistrationRepository,
} from "./ports.js";

export interface AnalyticsQuery {
  readonly currency?: string;
  readonly partnerId?: Ulid;
  readonly at?: IsoDateTime;
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
}

/**
 * Snapshot of everything the roll-ups read, taken once per request so every
 * figure in a response describes the same instant.
 */
export interface AnalyticsSnapshot {
  readonly at: IsoDateTime;
  readonly currency: string;
  readonly deals: readonly PipelineDeal[];
  readonly referrals: readonly PipelineReferral[];
  readonly orders: readonly PipelineOrder[];
  readonly tiers: ReadonlyMap<Ulid, PartnerTier>;
  readonly conflictsByPartner: ReadonlyMap<Ulid, number>;
}

/**
 * Partner pipeline analytics.
 *
 * This service does no maths: it projects aggregates into the flat records
 * `domain/pipeline` operates on, and hands them to the pure roll-ups. Keeping
 * projection and calculation apart is what lets the analytics be tested
 * without repositories and reused over a warehouse extract later.
 */
export class AnalyticsService {
  constructor(
    private readonly registrations: RegistrationRepository,
    private readonly referrals: ReferralRepository,
    private readonly orders: ChannelOrderRepository,
    private readonly partners: PartnerRepository,
    private readonly conflicts: ConflictRepository,
    private readonly clock: Clock,
  ) {}

  static toDeal(registration: DealRegistration, tier?: PartnerTier): PipelineDeal {
    return {
      registrationId: registration.id,
      number: registration.number,
      partnerId: registration.partnerId,
      partnerTier: tier ?? registration.tierAtApproval,
      status: registration.status,
      stage: registration.stage,
      probability: registration.probability,
      value: registration.estimatedValue,
      source: registration.source,
      customerKey: registration.customerKey,
      productLines: registration.productLines,
      createdAt: registration.createdAt,
      submittedAt: registration.submittedAt,
      approvedAt: registration.approval?.at,
      closedAt: registration.closure?.at,
      closedValue: registration.closure?.value,
      protectionEndsAt: registration.protection?.endsAt,
      lastActivityAt: registration.updatedAt,
      quoteCount: registration.quotes.length,
      orderCount: registration.orders.length,
    };
  }

  static toReferral(referral: Referral): PipelineReferral {
    return {
      referralId: referral.id,
      partnerId: referral.partnerId,
      status: referral.status,
      submittedAt: referral.submittedAt,
      acceptedAt: referral.attribution?.startsAt,
      convertedAt: referral.conversion?.at,
      wonValue: referral.outcomeValue,
      commissionAmount: referral.commission?.amount,
    };
  }

  static toOrder(order: ChannelOrder): PipelineOrder {
    return {
      orderId: order.id,
      partnerId: order.partnerId,
      registrationId: order.registrationId,
      netValue: order.netValue,
      status: order.status,
      orderedAt: order.orderedAt,
      sourceType: order.sourceType,
    };
  }

  /**
   * Loads and projects everything once. The reporting currency defaults to the
   * most common partner currency in the tenant rather than a hard-coded USD,
   * so a single-currency tenant never has to pass it.
   */
  async snapshot(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<AnalyticsSnapshot> {
    const at = query.at ?? this.clock.now();
    const partners = await this.partners.all(ctx.tenantId);
    const tiers = new Map<Ulid, PartnerTier>(partners.map((p) => [p.id, p.tier]));
    const currency = (query.currency ?? this.dominantCurrency(partners.map((p) => p.currency))).toUpperCase();

    const inRange = (value: IsoDateTime | undefined): boolean => {
      if (!value) return !query.from && !query.to;
      if (query.from && Date.parse(value) < Date.parse(query.from)) return false;
      if (query.to && Date.parse(value) > Date.parse(query.to)) return false;
      return true;
    };

    const registrations = (await this.registrations.all(ctx.tenantId)).filter(
      (r) => (!query.partnerId || r.partnerId === query.partnerId) && (!query.from && !query.to ? true : inRange(r.submittedAt ?? r.createdAt)),
    );
    const referrals = (await this.referrals.all(ctx.tenantId)).filter(
      (r) => (!query.partnerId || r.partnerId === query.partnerId) && (!query.from && !query.to ? true : inRange(r.submittedAt)),
    );
    const orders = (await this.orders.all(ctx.tenantId)).filter(
      (o) => (!query.partnerId || o.partnerId === query.partnerId) && (!query.from && !query.to ? true : inRange(o.orderedAt)),
    );

    const conflictsByPartner = new Map<Ulid, number>();
    for (const conflict of await this.conflicts.all(ctx.tenantId)) {
      for (const partnerId of [conflict.claimantPartnerId, conflict.incumbentPartnerId]) {
        if (!partnerId) continue;
        conflictsByPartner.set(partnerId, (conflictsByPartner.get(partnerId) ?? 0) + 1);
      }
    }

    return {
      at,
      currency,
      deals: registrations.map((r) => AnalyticsService.toDeal(r, tiers.get(r.partnerId))),
      referrals: referrals.map(AnalyticsService.toReferral),
      orders: orders.map(AnalyticsService.toOrder),
      tiers,
      conflictsByPartner,
    };
  }

  async pipelineByStage(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<StagePipeline> {
    const snapshot = await this.snapshot(ctx, query);
    return pipelineByStage(snapshot.deals, snapshot.currency);
  }

  async forecast(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<readonly ForecastBucket[]> {
    const snapshot = await this.snapshot(ctx, query);
    return forecastRollup(snapshot.deals, snapshot.currency);
  }

  async pipelineByPartner(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<PartnerPipelineReport> {
    const snapshot = await this.snapshot(ctx, query);
    return pipelineByPartner(snapshot.deals, snapshot.orders, snapshot.currency, snapshot.tiers);
  }

  async pipelineByTier(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<readonly TierBucket[]> {
    return pipelineByTier(await this.pipelineByPartner(ctx, query));
  }

  async funnel(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<ChannelFunnel> {
    const snapshot = await this.snapshot(ctx, query);
    return channelFunnel(snapshot.deals, snapshot.referrals, snapshot.orders);
  }

  async protectionExpiry(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<ExpiryReport> {
    const snapshot = await this.snapshot(ctx, query);
    return protectionExpiryReport(snapshot.deals, snapshot.at, snapshot.currency);
  }

  async sourceSplit(ctx: TenantContext, query: AnalyticsQuery = {}): Promise<SourceSplit> {
    const snapshot = await this.snapshot(ctx, query);
    return sourcedVsInfluenced(snapshot.orders, snapshot.currency);
  }

  async cohorts(
    ctx: TenantContext,
    granularity: CohortGranularity = "quarter",
    query: AnalyticsQuery = {},
  ): Promise<readonly Cohort[]> {
    const snapshot = await this.snapshot(ctx, query);
    return cohortReport(snapshot.deals, granularity, snapshot.currency);
  }

  async scorecards(
    ctx: TenantContext,
    query: AnalyticsQuery & { bookedValueTargetMinor?: number } = {},
  ): Promise<readonly PartnerScorecard[]> {
    const snapshot = await this.snapshot(ctx, query);
    const report = pipelineByPartner(snapshot.deals, snapshot.orders, snapshot.currency, snapshot.tiers);
    const target =
      query.bookedValueTargetMinor ??
      Math.max(1, ...report.partners.map((p) => p.bookedValue.amountMinor));
    return partnerScorecards({
      report,
      conflictsByPartner: snapshot.conflictsByPartner,
      bookedValueTargetMinor: target,
    });
  }

  async hygiene(
    ctx: TenantContext,
    query: AnalyticsQuery = {},
  ): Promise<{ stalled: readonly StalledDeal[]; slipped: readonly { registrationId: Ulid; number: string; overdueDays: number }[] }> {
    const snapshot = await this.snapshot(ctx, query);
    const expected = new Map<Ulid, IsoDateTime>();
    for (const registration of await this.registrations.all(ctx.tenantId)) {
      expected.set(registration.id, registration.expectedCloseDate);
    }
    return {
      stalled: stalledDeals(snapshot.deals, snapshot.at),
      slipped: slippedDeals(snapshot.deals, snapshot.at, expected),
    };
  }

  private dominantCurrency(currencies: readonly string[]): string {
    if (currencies.length === 0) return "USD";
    const counts = new Map<string, number>();
    for (const currency of currencies) counts.set(currency, (counts.get(currency) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]![0];
  }
}

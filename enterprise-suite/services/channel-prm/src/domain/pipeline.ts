import { money, type IsoDateTime, type Money, type Ulid } from "@enterprise-suite/shared-kernel";
import type { DealSource, RegistrationStatus } from "./deal-registration.js";
import { sumMoney, weightMoney, zeroMoney } from "./money-math.js";
import type { OrderSourceType } from "./channel-order.js";
import type { PartnerTier } from "./partner.js";
import { daysBetween } from "./protection.js";
import {
  CHANNEL_STAGES,
  forecastCategoryFor,
  isOpenStage,
  STALL_THRESHOLD_DAYS,
  type ChannelStage,
  type ForecastCategory,
} from "./stages.js";

/**
 * Partner pipeline analytics.
 *
 * Every roll-up here is a pure function over flat projections, so the same
 * maths runs over live repositories, a warehouse extract or a fixture in a
 * test. Two rules hold throughout:
 *
 * 1. **One currency per report.** Records in another currency are excluded and
 *    counted, never converted — there is no FX rate in this context.
 * 2. **Weighted value is derived, never stored.** Probability lives on the
 *    deal; every weighted figure is recomputed so a probability correction
 *    cannot leave a stale roll-up behind.
 */

export interface PipelineDeal {
  readonly registrationId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly partnerTier?: PartnerTier;
  readonly status: RegistrationStatus;
  readonly stage: ChannelStage;
  readonly probability: number;
  readonly value: Money;
  readonly source: DealSource;
  readonly customerKey: string;
  readonly productLines: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly submittedAt?: IsoDateTime;
  readonly approvedAt?: IsoDateTime;
  readonly closedAt?: IsoDateTime;
  readonly closedValue?: Money;
  readonly protectionEndsAt?: IsoDateTime;
  readonly lastActivityAt: IsoDateTime;
  readonly quoteCount: number;
  readonly orderCount: number;
}

export interface PipelineReferral {
  readonly referralId: Ulid;
  readonly partnerId: Ulid;
  readonly status: string;
  readonly submittedAt: IsoDateTime;
  readonly acceptedAt?: IsoDateTime;
  readonly convertedAt?: IsoDateTime;
  readonly wonValue?: Money;
  readonly commissionAmount?: Money;
}

export interface PipelineOrder {
  readonly orderId: Ulid;
  readonly partnerId: Ulid;
  readonly registrationId?: Ulid;
  readonly netValue: Money;
  readonly status: string;
  readonly orderedAt: IsoDateTime;
  readonly sourceType: OrderSourceType;
}

export interface CurrencyScope {
  readonly currency: string;
  readonly excludedByCurrency: number;
}

function scope<T>(
  records: readonly T[],
  currency: string,
  pick: (record: T) => Money | undefined,
): { kept: T[]; excluded: number } {
  const target = currency.toUpperCase();
  const kept: T[] = [];
  let excluded = 0;
  for (const record of records) {
    const amount = pick(record);
    if (amount && amount.currency !== target) {
      excluded += 1;
      continue;
    }
    kept.push(record);
  }
  return { kept, excluded };
}

const OPEN_STATUSES: readonly RegistrationStatus[] = ["submitted", "under_review", "approved"];

export function isOpenDeal(deal: PipelineDeal): boolean {
  return OPEN_STATUSES.includes(deal.status) && isOpenStage(deal.stage);
}

// --- stage roll-up ---------------------------------------------------------

export interface StageBucket {
  readonly stage: ChannelStage;
  readonly forecastCategory: ForecastCategory;
  readonly count: number;
  readonly value: Money;
  readonly weightedValue: Money;
  /** Share of open pipeline value, in basis points. */
  readonly shareBps: number;
}

export interface StagePipeline extends CurrencyScope {
  readonly buckets: readonly StageBucket[];
  readonly openCount: number;
  readonly openValue: Money;
  readonly weightedValue: Money;
}

export function pipelineByStage(deals: readonly PipelineDeal[], currency: string): StagePipeline {
  const { kept, excluded } = scope(deals, currency, (d) => d.value);
  const open = kept.filter(isOpenDeal);
  const openValue = sumMoney(open.map((d) => d.value), currency);

  const buckets: StageBucket[] = [];
  for (const stage of CHANNEL_STAGES) {
    if (!isOpenStage(stage)) continue;
    const inStage = open.filter((d) => d.stage === stage);
    const value = sumMoney(inStage.map((d) => d.value), currency);
    const weighted = sumMoney(inStage.map((d) => weightMoney(d.value, d.probability)), currency);
    const averageProbability =
      inStage.length === 0 ? 0 : inStage.reduce((sum, d) => sum + d.probability, 0) / inStage.length;
    buckets.push({
      stage,
      forecastCategory: forecastCategoryFor(stage, averageProbability),
      count: inStage.length,
      value,
      weightedValue: weighted,
      shareBps:
        openValue.amountMinor === 0 ? 0 : Math.round((value.amountMinor / openValue.amountMinor) * 10_000),
    });
  }

  return {
    currency: currency.toUpperCase(),
    excludedByCurrency: excluded,
    buckets,
    openCount: open.length,
    openValue,
    weightedValue: sumMoney(open.map((d) => weightMoney(d.value, d.probability)), currency),
  };
}

// --- forecast roll-up ------------------------------------------------------

export interface ForecastBucket {
  readonly category: ForecastCategory;
  readonly count: number;
  readonly value: Money;
  readonly weightedValue: Money;
}

export function forecastRollup(deals: readonly PipelineDeal[], currency: string): readonly ForecastBucket[] {
  const { kept } = scope(deals, currency, (d) => d.value);
  const categories: ForecastCategory[] = ["omitted", "pipeline", "best_case", "commit", "closed_won"];
  return categories.map((category) => {
    const matching = kept.filter((deal) => {
      if (category === "closed_won") return deal.status === "closed_won";
      if (!isOpenDeal(deal)) return false;
      return forecastCategoryFor(deal.stage, deal.probability) === category;
    });
    const values = matching.map((d) => (category === "closed_won" ? d.closedValue ?? d.value : d.value));
    return {
      category,
      count: matching.length,
      value: sumMoney(values, currency),
      weightedValue: sumMoney(
        matching.map((d, i) => (category === "closed_won" ? values[i]! : weightMoney(d.value, d.probability))),
        currency,
      ),
    };
  });
}

// --- partner roll-up -------------------------------------------------------

export interface PartnerPipeline {
  readonly partnerId: Ulid;
  readonly tier?: PartnerTier;
  readonly registrationsSubmitted: number;
  readonly registrationsApproved: number;
  readonly registrationsRejected: number;
  readonly registrationsExpired: number;
  readonly openCount: number;
  readonly openValue: Money;
  readonly weightedValue: Money;
  readonly wonCount: number;
  readonly wonValue: Money;
  readonly lostCount: number;
  /** Won / (won + lost), in basis points. */
  readonly winRateBps: number;
  /** Approved / submitted, in basis points. */
  readonly approvalRateBps: number;
  readonly averageDealValue: Money;
  readonly averageCycleDays?: number;
  readonly bookedValue: Money;
  readonly orderCount: number;
}

export interface PartnerPipelineReport extends CurrencyScope {
  readonly partners: readonly PartnerPipeline[];
  readonly totals: {
    readonly openValue: Money;
    readonly weightedValue: Money;
    readonly wonValue: Money;
    readonly bookedValue: Money;
  };
}

function rate(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Math.round((numerator / denominator) * 10_000);
}

export function pipelineByPartner(
  deals: readonly PipelineDeal[],
  orders: readonly PipelineOrder[],
  currency: string,
  tierOf?: ReadonlyMap<Ulid, PartnerTier>,
): PartnerPipelineReport {
  const target = currency.toUpperCase();
  const { kept, excluded } = scope(deals, target, (d) => d.value);
  const scopedOrders = scope(orders, target, (o) => o.netValue);

  const partnerIds = [...new Set([...kept.map((d) => d.partnerId), ...scopedOrders.kept.map((o) => o.partnerId)])];
  const partners: PartnerPipeline[] = partnerIds
    .map((partnerId) => {
      const mine = kept.filter((d) => d.partnerId === partnerId);
      const myOrders = scopedOrders.kept.filter((o) => o.partnerId === partnerId && o.status !== "cancelled");
      const open = mine.filter(isOpenDeal);
      const won = mine.filter((d) => d.status === "closed_won");
      const lost = mine.filter((d) => d.status === "closed_lost");
      const submitted = mine.filter((d) => d.submittedAt !== undefined);
      const approved = mine.filter((d) => d.approvedAt !== undefined);
      const cycles = won
        .map((d) => (d.closedAt && d.submittedAt ? daysBetween(d.submittedAt, d.closedAt) : undefined))
        .filter((v): v is number => v !== undefined);
      const wonValues = won.map((d) => d.closedValue ?? d.value);
      const openValue = sumMoney(open.map((d) => d.value), target);
      return {
        partnerId,
        tier: tierOf?.get(partnerId) ?? mine.find((d) => d.partnerTier)?.partnerTier,
        registrationsSubmitted: submitted.length,
        registrationsApproved: approved.length,
        registrationsRejected: mine.filter((d) => d.status === "rejected").length,
        registrationsExpired: mine.filter((d) => d.status === "expired").length,
        openCount: open.length,
        openValue,
        weightedValue: sumMoney(open.map((d) => weightMoney(d.value, d.probability)), target),
        wonCount: won.length,
        wonValue: sumMoney(wonValues, target),
        lostCount: lost.length,
        winRateBps: rate(won.length, won.length + lost.length),
        approvalRateBps: rate(approved.length, submitted.length),
        averageDealValue:
          won.length === 0
            ? zeroMoney(target)
            : money(Math.round(sumMoney(wonValues, target).amountMinor / won.length), target),
        averageCycleDays:
          cycles.length === 0 ? undefined : Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length),
        bookedValue: sumMoney(myOrders.map((o) => o.netValue), target),
        orderCount: myOrders.length,
      };
    })
    .sort((a, b) => b.openValue.amountMinor - a.openValue.amountMinor);

  return {
    currency: target,
    excludedByCurrency: excluded + scopedOrders.excluded,
    partners,
    totals: {
      openValue: sumMoney(partners.map((p) => p.openValue), target),
      weightedValue: sumMoney(partners.map((p) => p.weightedValue), target),
      wonValue: sumMoney(partners.map((p) => p.wonValue), target),
      bookedValue: sumMoney(partners.map((p) => p.bookedValue), target),
    },
  };
}

// --- tier roll-up ----------------------------------------------------------

export interface TierBucket {
  readonly tier: PartnerTier | "unknown";
  readonly partnerCount: number;
  readonly openValue: Money;
  readonly wonValue: Money;
  readonly winRateBps: number;
}

export function pipelineByTier(report: PartnerPipelineReport): readonly TierBucket[] {
  const groups = new Map<PartnerTier | "unknown", PartnerPipeline[]>();
  for (const partner of report.partners) {
    const key = partner.tier ?? "unknown";
    const bucket = groups.get(key) ?? [];
    bucket.push(partner);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .map(([tier, partners]) => {
      const won = partners.reduce((sum, p) => sum + p.wonCount, 0);
      const lost = partners.reduce((sum, p) => sum + p.lostCount, 0);
      return {
        tier,
        partnerCount: partners.length,
        openValue: sumMoney(partners.map((p) => p.openValue), report.currency),
        wonValue: sumMoney(partners.map((p) => p.wonValue), report.currency),
        winRateBps: rate(won, won + lost),
      };
    })
    .sort((a, b) => b.openValue.amountMinor - a.openValue.amountMinor);
}

// --- funnel ----------------------------------------------------------------

export interface FunnelStep {
  readonly step: string;
  readonly count: number;
  /** Conversion from the previous step, in basis points. */
  readonly conversionBps: number;
}

export interface ChannelFunnel {
  readonly steps: readonly FunnelStep[];
  /** Referral submitted → registration won, end to end. */
  readonly endToEndBps: number;
}

/**
 * The channel funnel as the channel team reads it: a referral becomes a
 * registration, a registration earns protection, protection turns into a
 * quote, a quote into an order, an order into a won deal.
 */
export function channelFunnel(
  deals: readonly PipelineDeal[],
  referrals: readonly PipelineReferral[],
  orders: readonly PipelineOrder[],
): ChannelFunnel {
  const counts: readonly { step: string; count: number }[] = [
    { step: "referrals_submitted", count: referrals.length },
    { step: "referrals_accepted", count: referrals.filter((r) => r.acceptedAt !== undefined).length },
    { step: "registrations_submitted", count: deals.filter((d) => d.submittedAt !== undefined).length },
    { step: "registrations_approved", count: deals.filter((d) => d.approvedAt !== undefined).length },
    { step: "deals_quoted", count: deals.filter((d) => d.quoteCount > 0).length },
    { step: "deals_ordered", count: orders.filter((o) => o.status !== "cancelled").length },
    { step: "deals_won", count: deals.filter((d) => d.status === "closed_won").length },
  ];

  const steps = counts.map((entry, index) => ({
    step: entry.step,
    count: entry.count,
    conversionBps: index === 0 ? 10_000 : rate(entry.count, counts[index - 1]!.count),
  }));

  return {
    steps,
    endToEndBps: rate(counts[counts.length - 1]!.count, counts[0]!.count),
  };
}

// --- protection expiry -----------------------------------------------------

export interface ExpiryBucket {
  readonly label: string;
  readonly fromDays: number;
  readonly toDays: number;
  readonly count: number;
  readonly value: Money;
  readonly registrationNumbers: readonly string[];
}

export interface ExpiryReport extends CurrencyScope {
  readonly at: IsoDateTime;
  readonly buckets: readonly ExpiryBucket[];
  readonly lapsedUnclosed: readonly string[];
  readonly atRiskValue: Money;
}

const EXPIRY_BUCKETS: readonly { label: string; from: number; to: number }[] = [
  { label: "0-7d", from: 0, to: 7 },
  { label: "8-14d", from: 8, to: 14 },
  { label: "15-30d", from: 15, to: 30 },
  { label: "30d+", from: 31, to: Number.POSITIVE_INFINITY },
];

/**
 * Which protected deals are about to lose their exclusivity. `atRiskValue` is
 * the open value protected for 14 days or less — the number a channel manager
 * works down each week.
 */
export function protectionExpiryReport(
  deals: readonly PipelineDeal[],
  at: IsoDateTime,
  currency: string,
): ExpiryReport {
  const { kept, excluded } = scope(deals, currency, (d) => d.value);
  const approved = kept.filter((d) => d.status === "approved" && d.protectionEndsAt);

  const buckets = EXPIRY_BUCKETS.map((bucket) => {
    const inBucket = approved.filter((deal) => {
      const left = daysBetween(at, deal.protectionEndsAt!);
      if (left <= 0) return false;
      const days = Math.ceil(left);
      return days >= bucket.from && days <= bucket.to;
    });
    return {
      label: bucket.label,
      fromDays: bucket.from,
      toDays: bucket.to === Number.POSITIVE_INFINITY ? -1 : bucket.to,
      count: inBucket.length,
      value: sumMoney(inBucket.map((d) => d.value), currency),
      registrationNumbers: inBucket.map((d) => d.number).sort(),
    };
  });

  const atRisk = approved.filter((deal) => {
    const left = daysBetween(at, deal.protectionEndsAt!);
    return left > 0 && Math.ceil(left) <= 14;
  });

  return {
    currency: currency.toUpperCase(),
    excludedByCurrency: excluded,
    at,
    buckets,
    lapsedUnclosed: approved
      .filter((deal) => daysBetween(at, deal.protectionEndsAt!) <= 0)
      .map((d) => d.number)
      .sort(),
    atRiskValue: sumMoney(atRisk.map((d) => d.value), currency),
  };
}

// --- sourced vs influenced -------------------------------------------------

export interface SourceSplit extends CurrencyScope {
  readonly partnerSourced: Money;
  readonly vendorSourced: Money;
  readonly coSell: Money;
  readonly total: Money;
  readonly partnerSourcedShareBps: number;
  readonly orderCount: number;
}

/**
 * Revenue attribution across the channel. Co-sell is reported separately
 * rather than folded into either side, because crediting it twice is the
 * classic way channel revenue reporting stops adding up.
 */
export function sourcedVsInfluenced(orders: readonly PipelineOrder[], currency: string): SourceSplit {
  const target = currency.toUpperCase();
  const { kept, excluded } = scope(orders, target, (o) => o.netValue);
  const live = kept.filter((o) => o.status !== "cancelled");
  const by = (type: OrderSourceType) =>
    sumMoney(live.filter((o) => o.sourceType === type).map((o) => o.netValue), target);

  const partnerSourced = by("partner_sourced");
  const vendorSourced = by("vendor_sourced");
  const coSell = by("co_sell");
  const total = sumMoney([partnerSourced, vendorSourced, coSell], target);

  return {
    currency: target,
    excludedByCurrency: excluded,
    partnerSourced,
    vendorSourced,
    coSell,
    total,
    partnerSourcedShareBps: rate(partnerSourced.amountMinor, total.amountMinor),
    orderCount: live.length,
  };
}

// --- cohorts ---------------------------------------------------------------

export type CohortGranularity = "month" | "quarter";

export interface Cohort {
  readonly period: string;
  readonly registrations: number;
  readonly registeredValue: Money;
  readonly won: number;
  readonly wonValue: Money;
  readonly lost: number;
  readonly open: number;
  readonly conversionBps: number;
}

export function periodKey(at: IsoDateTime, granularity: CohortGranularity): string {
  const date = new Date(Date.parse(at));
  const year = date.getUTCFullYear();
  if (granularity === "month") return `${year}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${year}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/**
 * Groups registrations by the period they were *submitted* in and follows what
 * became of them. Cohorting on submission (not close) is what makes conversion
 * comparable across periods.
 */
export function cohortReport(
  deals: readonly PipelineDeal[],
  granularity: CohortGranularity,
  currency: string,
): readonly Cohort[] {
  const { kept } = scope(deals, currency, (d) => d.value);
  const groups = new Map<string, PipelineDeal[]>();
  for (const deal of kept) {
    if (!deal.submittedAt) continue;
    const key = periodKey(deal.submittedAt, granularity);
    const bucket = groups.get(key) ?? [];
    bucket.push(deal);
    groups.set(key, bucket);
  }
  return [...groups.entries()]
    .map(([period, cohort]) => {
      const won = cohort.filter((d) => d.status === "closed_won");
      return {
        period,
        registrations: cohort.length,
        registeredValue: sumMoney(cohort.map((d) => d.value), currency),
        won: won.length,
        wonValue: sumMoney(won.map((d) => d.closedValue ?? d.value), currency),
        lost: cohort.filter((d) => d.status === "closed_lost").length,
        open: cohort.filter(isOpenDeal).length,
        conversionBps: rate(won.length, cohort.length),
      };
    })
    .sort((a, b) => a.period.localeCompare(b.period));
}

// --- scorecards ------------------------------------------------------------

export interface PartnerScorecard {
  readonly partnerId: Ulid;
  readonly tier?: PartnerTier;
  /** 0-100 composite. */
  readonly score: number;
  readonly components: readonly { readonly name: string; readonly points: number; readonly max: number; readonly note: string }[];
  readonly bookedValue: Money;
  readonly winRateBps: number;
  readonly approvalRateBps: number;
  readonly averageCycleDays?: number;
  readonly conflictCount: number;
}

export interface ScorecardInput {
  readonly report: PartnerPipelineReport;
  readonly conflictsByPartner: ReadonlyMap<Ulid, number>;
  /** Booked value that earns full marks; usually the tenant's tier threshold. */
  readonly bookedValueTargetMinor: number;
}

/**
 * Composite partner score out of 100: revenue delivered (40), win rate (25),
 * registration quality (20), speed (10), clean conduct (5). The weights are a
 * program decision, so they are declared in one table and every component
 * reports the points it contributed.
 */
export function partnerScorecards(input: ScorecardInput): readonly PartnerScorecard[] {
  return input.report.partners
    .map((partner) => {
      const components: { name: string; points: number; max: number; note: string }[] = [];

      const revenueRatio =
        input.bookedValueTargetMinor <= 0
          ? 0
          : Math.min(1, partner.bookedValue.amountMinor / input.bookedValueTargetMinor);
      components.push({
        name: "revenue",
        points: Math.round(revenueRatio * 40),
        max: 40,
        note: `${partner.bookedValue.amountMinor / 100} ${partner.bookedValue.currency} booked`,
      });

      components.push({
        name: "win_rate",
        points: Math.round((partner.winRateBps / 10_000) * 25),
        max: 25,
        note: `${(partner.winRateBps / 100).toFixed(1)}% of closed deals won`,
      });

      components.push({
        name: "registration_quality",
        points: Math.round((partner.approvalRateBps / 10_000) * 20),
        max: 20,
        note: `${partner.registrationsApproved}/${partner.registrationsSubmitted} registrations approved`,
      });

      const cycle = partner.averageCycleDays;
      const speedPoints = cycle === undefined ? 0 : Math.max(0, Math.round(10 - Math.max(0, cycle - 30) / 9));
      components.push({
        name: "speed",
        points: Math.min(10, speedPoints),
        max: 10,
        note: cycle === undefined ? "no closed deals yet" : `${cycle} day average cycle`,
      });

      const conflicts = input.conflictsByPartner.get(partner.partnerId) ?? 0;
      components.push({
        name: "conduct",
        points: Math.max(0, 5 - conflicts),
        max: 5,
        note: conflicts === 0 ? "no channel conflicts" : `${conflicts} conflict case(s)`,
      });

      return {
        partnerId: partner.partnerId,
        tier: partner.tier,
        score: components.reduce((sum, c) => sum + c.points, 0),
        components,
        bookedValue: partner.bookedValue,
        winRateBps: partner.winRateBps,
        approvalRateBps: partner.approvalRateBps,
        averageCycleDays: partner.averageCycleDays,
        conflictCount: conflicts,
      };
    })
    .sort((a, b) => b.score - a.score);
}

// --- hygiene ---------------------------------------------------------------

export interface StalledDeal {
  readonly registrationId: Ulid;
  readonly number: string;
  readonly partnerId: Ulid;
  readonly stage: ChannelStage;
  readonly idleDays: number;
  readonly thresholdDays: number;
  readonly value: Money;
}

/** Open deals untouched for longer than their stage tolerates. */
export function stalledDeals(deals: readonly PipelineDeal[], at: IsoDateTime): readonly StalledDeal[] {
  return deals
    .filter(isOpenDeal)
    .map((deal) => {
      const idleDays = Math.max(0, daysBetween(deal.lastActivityAt, at));
      return {
        registrationId: deal.registrationId,
        number: deal.number,
        partnerId: deal.partnerId,
        stage: deal.stage,
        idleDays: Math.round(idleDays),
        thresholdDays: STALL_THRESHOLD_DAYS[deal.stage],
        value: deal.value,
      };
    })
    .filter((deal) => deal.idleDays > deal.thresholdDays)
    .sort((a, b) => b.idleDays - a.idleDays);
}

/** Deals whose expected close date has passed while still open. */
export function slippedDeals(deals: readonly PipelineDeal[], at: IsoDateTime, expected: ReadonlyMap<Ulid, IsoDateTime>) {
  return deals
    .filter(isOpenDeal)
    .map((deal) => {
      const closeDate = expected.get(deal.registrationId);
      if (!closeDate) return undefined;
      const overdue = daysBetween(closeDate, at);
      return overdue > 0
        ? { registrationId: deal.registrationId, number: deal.number, overdueDays: Math.round(overdue), value: deal.value }
        : undefined;
    })
    .filter((entry): entry is { registrationId: Ulid; number: string; overdueDays: number; value: Money } => !!entry)
    .sort((a, b) => b.overdueDays - a.overdueDays);
}

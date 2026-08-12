import { DomainError, money, type Money, type Ulid } from "@enterprise-suite/shared-kernel";
import type { Touchpoint } from "./touchpoint.js";

/**
 * Supported multi-touch attribution models:
 * - first_touch: 100% of conversion value to the earliest touchpoint
 * - last_touch: 100% to the latest touchpoint before conversion
 * - linear: value split evenly across all touchpoints
 * - position_based: 40% first, 40% last, remaining 20% split across the middle
 */
export const ATTRIBUTION_MODELS = [
  "first_touch",
  "last_touch",
  "linear",
  "position_based",
] as const;
export type AttributionModel = (typeof ATTRIBUTION_MODELS)[number];

export function assertAttributionModel(value: string): AttributionModel {
  if (!(ATTRIBUTION_MODELS as readonly string[]).includes(value)) {
    throw new DomainError(`Unknown attribution model: ${value}`, "ATTRIBUTION_INVALID_MODEL");
  }
  return value as AttributionModel;
}

export interface CreditAllocation {
  readonly touchpointId: Ulid;
  readonly leadId: Ulid;
  readonly campaignId?: Ulid;
  readonly channelId?: Ulid;
  /** Fractional weight in [0, 1]; weights over one conversion sum to 1. */
  readonly weight: number;
  /** Integer minor units credited; allocations over one conversion sum to the full value. */
  readonly credited: Money;
}

/** Model weights for n ordered touchpoints. Always sums to 1. */
export function modelWeights(model: AttributionModel, n: number): number[] {
  if (n <= 0) {
    throw new DomainError("Cannot compute weights for zero touchpoints", "ATTRIBUTION_NO_TOUCHPOINTS");
  }
  if (n === 1) return [1];
  switch (model) {
    case "first_touch":
      return [1, ...Array<number>(n - 1).fill(0)];
    case "last_touch":
      return [...Array<number>(n - 1).fill(0), 1];
    case "linear":
      return Array<number>(n).fill(1 / n);
    case "position_based": {
      if (n === 2) return [0.5, 0.5];
      const middle = 0.2 / (n - 2);
      return [0.4, ...Array<number>(n - 2).fill(middle), 0.4];
    }
  }
}

/**
 * Splits an integer-minor-unit amount by fractional weights without losing
 * or minting cents: each share gets floor(amount * weight), and the leftover
 * minor units go to the shares with the largest fractional remainders
 * (ties resolved by position for determinism).
 */
export function splitMoneyByWeights(value: Money, weights: readonly number[]): Money[] {
  const total = value.amountMinor;
  const raw = weights.map((w) => total * w);
  const floors = raw.map(Math.floor);
  let leftover = total - floors.reduce((a, b) => a + b, 0);
  const byRemainder = raw
    .map((r, i) => ({ index: i, remainder: r - Math.floor(r) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const shares = [...floors];
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    shares[index]! += 1;
    leftover -= 1;
  }
  return shares.map((s) => money(s, value.currency));
}

/**
 * Allocates a conversion's value across its ordered journey touchpoints.
 * Touchpoints are sorted by occurrence time; ties keep input order.
 */
export function allocateCredit(
  model: AttributionModel,
  touchpoints: readonly Touchpoint[],
  conversionValue: Money,
): CreditAllocation[] {
  if (touchpoints.length === 0) {
    throw new DomainError(
      "Cannot attribute a conversion without touchpoints",
      "ATTRIBUTION_NO_TOUCHPOINTS",
    );
  }
  const ordered = [...touchpoints].sort((a, b) =>
    a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0,
  );
  const weights = modelWeights(model, ordered.length);
  const shares = splitMoneyByWeights(conversionValue, weights);
  return ordered.map((tp, i) => ({
    touchpointId: tp.id,
    leadId: tp.leadId,
    campaignId: tp.campaignId,
    channelId: tp.channelId,
    weight: weights[i]!,
    credited: shares[i]!,
  }));
}

// ---------------------------------------------------------------------------
// Report aggregation
// ---------------------------------------------------------------------------

export interface ConversionInput {
  readonly leadId: Ulid;
  readonly value: Money;
  readonly touchpoints: readonly Touchpoint[];
}

export interface AttributionBucket {
  readonly key: string;
  readonly creditedMinor: number;
  readonly currency: string;
  /** Share of total attributed revenue in [0, 1]. */
  readonly share: number;
  readonly touchpointCount: number;
}

export interface AttributionReport {
  readonly model: AttributionModel;
  readonly currency: string;
  readonly conversionCount: number;
  readonly totalRevenueMinor: number;
  readonly byCampaign: readonly AttributionBucket[];
  readonly byChannel: readonly AttributionBucket[];
}

const UNATTRIBUTED = "unattributed";

/**
 * Runs the chosen model over every conversion and aggregates credited
 * revenue by campaign and by channel. All conversions must share a currency
 * (cross-currency rollups belong to Finance, which owns FX rates).
 */
export function computeAttributionReport(
  model: AttributionModel,
  conversions: readonly ConversionInput[],
): AttributionReport {
  const currency = conversions[0]?.value.currency ?? "USD";
  const campaignCredit = new Map<string, { credited: number; touches: number }>();
  const channelCredit = new Map<string, { credited: number; touches: number }>();
  let totalRevenueMinor = 0;

  const bump = (
    map: Map<string, { credited: number; touches: number }>,
    key: string,
    creditedMinor: number,
  ) => {
    const entry = map.get(key) ?? { credited: 0, touches: 0 };
    entry.credited += creditedMinor;
    entry.touches += 1;
    map.set(key, entry);
  };

  for (const conversion of conversions) {
    if (conversion.value.currency !== currency) {
      throw new DomainError(
        `Mixed currencies in attribution input: ${currency} vs ${conversion.value.currency}`,
        "ATTRIBUTION_CURRENCY_MISMATCH",
      );
    }
    if (conversion.touchpoints.length === 0) continue;
    totalRevenueMinor += conversion.value.amountMinor;
    for (const allocation of allocateCredit(model, conversion.touchpoints, conversion.value)) {
      bump(campaignCredit, allocation.campaignId ?? UNATTRIBUTED, allocation.credited.amountMinor);
      bump(channelCredit, allocation.channelId ?? UNATTRIBUTED, allocation.credited.amountMinor);
    }
  }

  const toBuckets = (map: Map<string, { credited: number; touches: number }>): AttributionBucket[] =>
    [...map.entries()]
      .map(([key, { credited, touches }]) => ({
        key,
        creditedMinor: credited,
        currency,
        share: totalRevenueMinor === 0 ? 0 : credited / totalRevenueMinor,
        touchpointCount: touches,
      }))
      .sort((a, b) => b.creditedMinor - a.creditedMinor || a.key.localeCompare(b.key));

  return {
    model,
    currency,
    conversionCount: conversions.filter((c) => c.touchpoints.length > 0).length,
    totalRevenueMinor,
    byCampaign: toBuckets(campaignCredit),
    byChannel: toBuckets(channelCredit),
  };
}

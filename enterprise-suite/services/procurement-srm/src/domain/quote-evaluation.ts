import { money, type Money, type Ulid } from "@enterprise-suite/shared-kernel";
import {
  BPS_ONE,
  extendPrice,
  subMoney,
  sumMoney,
  varianceBps,
  zeroMoney,
  type IsoDate,
} from "./common.js";
import type { RequestForQuote } from "./rfq.js";
import type { SupplierQuote } from "./quote.js";
import type { RiskTier } from "./supplier.js";

/** Supplier attributes the evaluator needs but the quote does not carry. */
export interface SupplierScoreInput {
  readonly supplierId: Ulid;
  readonly displayName: string;
  /** 0-10000; sourced from srm-core / quality-qms scorecards. */
  readonly qualityScoreBps: number;
  readonly riskTier: RiskTier;
  readonly paymentTermsDays: number;
}

export interface EvaluatedLine {
  readonly rfqLineNumber: number;
  readonly quoted: boolean;
  readonly netUnitPrice?: Money;
  /** Supplier's unit price applied to the RFQ quantity — the comparable basket. */
  readonly extendedValue?: Money;
  readonly leadTimeDays?: number;
  readonly isLowestPrice: boolean;
  readonly alternativeItemCode?: string;
}

export interface QuoteScorecard {
  readonly quoteId: Ulid;
  readonly quoteNumber: string;
  readonly supplierId: Ulid;
  readonly supplierName: string;
  /** Basket value: supplier unit prices × RFQ quantities, quoted lines only. */
  readonly comparableValue: Money;
  readonly quotedLineCount: number;
  /** 10000 when the quote covers every RFQ line. */
  readonly coverageBps: number;
  readonly maxLeadTimeDays: number;
  readonly priceScoreBps: number;
  readonly leadTimeScoreBps: number;
  readonly qualityScoreBps: number;
  readonly complianceScoreBps: number;
  readonly totalScoreBps: number;
  readonly rank: number;
  readonly complete: boolean;
  readonly disqualifiedReason?: string;
  readonly lines: readonly EvaluatedLine[];
}

export interface LineComparison {
  readonly rfqLineNumber: number;
  readonly description: string;
  readonly bestQuoteId?: Ulid;
  readonly bestSupplierId?: Ulid;
  readonly bestValue?: Money;
  readonly highestValue?: Money;
  /** Spread between the cheapest and dearest bid, in basis points. */
  readonly spreadBps: number;
  readonly bidCount: number;
}

export interface SplitAwardRecommendation {
  readonly awards: ReadonlyArray<{
    quoteId: Ulid;
    supplierId: Ulid;
    lineNumbers: readonly number[];
    value: Money;
  }>;
  readonly totalValue: Money;
  /** Saving over awarding everything to the best single supplier. */
  readonly savingVsSingleAward: Money;
  readonly supplierCount: number;
}

export interface RfqEvaluation {
  readonly rfqId: Ulid;
  readonly rfqNumber: string;
  readonly currency: string;
  readonly evaluatedAt: string;
  readonly scorecards: readonly QuoteScorecard[];
  readonly lineComparisons: readonly LineComparison[];
  readonly recommendedQuoteId?: Ulid;
  readonly splitAward?: SplitAwardRecommendation;
  /** Comparable value of the winning single award against `baseline`. */
  readonly savingVsBaseline?: Money;
  readonly excludedQuotes: ReadonlyArray<{ quoteId: Ulid; reason: string }>;
}

const RISK_SCORE_BPS: Record<RiskTier, number> = {
  low: 10_000,
  medium: 6_000,
  high: 2_000,
};

export interface EvaluationOptions {
  /** Quotes not valid on this date are excluded. */
  readonly onDate?: IsoDate;
  /** Estimated value from the requisition, used for the savings figure. */
  readonly baseline?: Money;
  /** Include quotes that do not cover every RFQ line (default true). */
  readonly allowPartial?: boolean;
}

/**
 * Ranks the quotes on an RFQ using the RFQ's own weighting.
 *
 * All bids are re-priced onto the RFQ's quantities so suppliers cannot game
 * the comparison by quoting different volumes; incomplete bids keep their
 * coverage ratio visible instead of being silently normalised away.
 */
export function evaluateQuotes(
  rfq: RequestForQuote,
  quotes: readonly SupplierQuote[],
  suppliers: readonly SupplierScoreInput[],
  options: EvaluationOptions = {},
): RfqEvaluation {
  const currency = rfq.currency;
  const allowPartial = options.allowPartial ?? true;
  const supplierById = new Map(suppliers.map((supplier) => [supplier.supplierId, supplier]));
  const excluded: Array<{ quoteId: Ulid; reason: string }> = [];

  const considered = quotes.filter((quote) => {
    if (quote.rfqId !== rfq.id) {
      excluded.push({ quoteId: quote.id, reason: "belongs to a different RFQ" });
      return false;
    }
    if (!["submitted", "shortlisted", "accepted"].includes(quote.status)) {
      excluded.push({ quoteId: quote.id, reason: `status is ${quote.status}` });
      return false;
    }
    if (quote.currency !== currency) {
      excluded.push({ quoteId: quote.id, reason: `quoted in ${quote.currency}, RFQ is ${currency}` });
      return false;
    }
    if (options.onDate && !quote.isValidOn(options.onDate)) {
      excluded.push({ quoteId: quote.id, reason: `expired on ${quote.validUntil}` });
      return false;
    }
    return true;
  });

  // Comparable basket per quote: supplier unit prices × RFQ quantities.
  const baskets = new Map<Ulid, Map<number, { unitPrice: Money; extended: Money; leadTimeDays: number }>>();
  for (const quote of considered) {
    const basket = new Map<number, { unitPrice: Money; extended: Money; leadTimeDays: number }>();
    for (const rfqLine of rfq.lines) {
      const quoteLine = quote.line(rfqLine.lineNumber);
      if (!quoteLine) continue;
      basket.set(rfqLine.lineNumber, {
        unitPrice: quoteLine.netUnitPrice,
        extended: extendPrice(quoteLine.netUnitPrice, rfqLine.quantity),
        leadTimeDays: quoteLine.leadTimeDays,
      });
    }
    baskets.set(quote.id, basket);
  }

  const eligible = considered.filter((quote) => {
    const basket = baskets.get(quote.id);
    const complete = basket !== undefined && basket.size === rfq.lines.length;
    if (!complete && !allowPartial) {
      excluded.push({ quoteId: quote.id, reason: "does not cover every RFQ line" });
      return false;
    }
    if (basket === undefined || basket.size === 0) {
      excluded.push({ quoteId: quote.id, reason: "prices none of the RFQ lines" });
      return false;
    }
    return true;
  });

  const comparableValues = new Map<Ulid, Money>();
  for (const quote of eligible) {
    const basket = baskets.get(quote.id) ?? new Map();
    comparableValues.set(
      quote.id,
      sumMoney(
        [...basket.values()].map((entry) => entry.extended),
        currency,
      ),
    );
  }

  // Price is scored on the full-basket value so partial bids are not flattered
  // by simply omitting the expensive lines.
  const normalizedValues = new Map<Ulid, number>();
  for (const quote of eligible) {
    const basket = baskets.get(quote.id) ?? new Map();
    const comparable = comparableValues.get(quote.id)?.amountMinor ?? 0;
    const coverage = rfq.lines.length === 0 ? 1 : basket.size / rfq.lines.length;
    normalizedValues.set(quote.id, coverage === 0 ? Number.MAX_SAFE_INTEGER : comparable / coverage);
  }

  const bestNormalizedValue = Math.min(
    ...[...normalizedValues.values()].filter((value) => value > 0),
    Number.MAX_SAFE_INTEGER,
  );
  const bestLeadTime = Math.min(
    ...eligible.map((quote) => quote.maxLeadTimeDays),
    Number.MAX_SAFE_INTEGER,
  );

  // Cheapest bid per line, resolved before scorecards so each card can flag
  // the lines it wins outright.
  const lowestPriceByLine = new Map<number, Ulid>();
  for (const rfqLine of rfq.lines) {
    let best: { quoteId: Ulid; amountMinor: number } | undefined;
    for (const quote of eligible) {
      const entry = baskets.get(quote.id)?.get(rfqLine.lineNumber);
      if (!entry) continue;
      if (!best || entry.extended.amountMinor < best.amountMinor) {
        best = { quoteId: quote.id, amountMinor: entry.extended.amountMinor };
      }
    }
    if (best) lowestPriceByLine.set(rfqLine.lineNumber, best.quoteId);
  }

  const unranked: Array<Omit<QuoteScorecard, "rank">> = eligible.map((quote) => {
    const basket = baskets.get(quote.id) ?? new Map();
    const supplier = supplierById.get(quote.supplierId);
    const normalized = normalizedValues.get(quote.id) ?? Number.MAX_SAFE_INTEGER;
    const priceScoreBps =
      bestNormalizedValue === Number.MAX_SAFE_INTEGER || normalized <= 0
        ? 0
        : clampBps(Math.round((bestNormalizedValue / normalized) * BPS_ONE));
    const leadTimeScoreBps =
      bestLeadTime === Number.MAX_SAFE_INTEGER
        ? 0
        : clampBps(Math.round(((bestLeadTime + 1) / (quote.maxLeadTimeDays + 1)) * BPS_ONE));
    const qualityScoreBps = clampBps(supplier?.qualityScoreBps ?? 5_000);
    const complianceScoreBps = complianceScore(rfq.paymentTermsDays, quote.paymentTermsDays, supplier);
    const weights = rfq.weights;
    const totalScoreBps = Math.round(
      (priceScoreBps * weights.priceBps +
        leadTimeScoreBps * weights.leadTimeBps +
        qualityScoreBps * weights.qualityBps +
        complianceScoreBps * weights.complianceBps) /
        BPS_ONE,
    );
    const lines: EvaluatedLine[] = rfq.lines.map((rfqLine) => {
      const entry = basket.get(rfqLine.lineNumber);
      return {
        rfqLineNumber: rfqLine.lineNumber,
        quoted: entry !== undefined,
        netUnitPrice: entry?.unitPrice,
        extendedValue: entry?.extended,
        leadTimeDays: entry?.leadTimeDays,
        isLowestPrice: entry !== undefined && lowestPriceByLine.get(rfqLine.lineNumber) === quote.id,
        alternativeItemCode: quote.line(rfqLine.lineNumber)?.alternativeItemCode,
      };
    });
    return {
      quoteId: quote.id,
      quoteNumber: quote.quoteNumber,
      supplierId: quote.supplierId,
      supplierName: supplier?.displayName ?? quote.supplierId,
      comparableValue: comparableValues.get(quote.id) ?? zeroMoney(currency),
      quotedLineCount: basket.size,
      coverageBps:
        rfq.lines.length === 0 ? BPS_ONE : Math.round((basket.size / rfq.lines.length) * BPS_ONE),
      maxLeadTimeDays: quote.maxLeadTimeDays,
      priceScoreBps,
      leadTimeScoreBps,
      qualityScoreBps,
      complianceScoreBps,
      totalScoreBps,
      complete: basket.size === rfq.lines.length,
      lines,
    };
  });

  const scorecards: QuoteScorecard[] = [...unranked]
    .sort(
      (a, b) =>
        b.totalScoreBps - a.totalScoreBps ||
        a.comparableValue.amountMinor - b.comparableValue.amountMinor,
    )
    .map((card, index) => ({ ...card, rank: index + 1 }));

  const lineComparisons: LineComparison[] = rfq.lines.map((rfqLine) => {
    const bids = eligible
      .map((quote) => ({ quote, entry: baskets.get(quote.id)?.get(rfqLine.lineNumber) }))
      .filter((bid): bid is { quote: SupplierQuote; entry: { unitPrice: Money; extended: Money; leadTimeDays: number } } =>
        bid.entry !== undefined,
      )
      .sort((a, b) => a.entry.extended.amountMinor - b.entry.extended.amountMinor);
    if (bids.length === 0) {
      return {
        rfqLineNumber: rfqLine.lineNumber,
        description: rfqLine.description,
        spreadBps: 0,
        bidCount: 0,
      };
    }
    const best = bids[0];
    const worst = bids[bids.length - 1];
    return {
      rfqLineNumber: rfqLine.lineNumber,
      description: rfqLine.description,
      bestQuoteId: best.quote.id,
      bestSupplierId: best.quote.supplierId,
      bestValue: best.entry.extended,
      highestValue: worst.entry.extended,
      spreadBps: varianceBps(worst.entry.extended.amountMinor, best.entry.extended.amountMinor),
      bidCount: bids.length,
    };
  });

  // Only a complete bid can win the whole basket outright.
  const recommended = scorecards.find((card) => card.complete) ?? scorecards[0];
  const splitAward = buildSplitAward(lineComparisons, currency, recommended);

  const savingVsBaseline =
    options.baseline && recommended
      ? subMoney(options.baseline, recommended.comparableValue)
      : undefined;

  return {
    rfqId: rfq.id,
    rfqNumber: rfq.rfqNumber,
    currency,
    evaluatedAt: new Date().toISOString(),
    scorecards,
    lineComparisons,
    recommendedQuoteId: recommended?.quoteId,
    splitAward,
    savingVsBaseline,
    excludedQuotes: excluded,
  };
}

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(BPS_ONE, value));
}

/**
 * Compliance blends supplier risk tier with how well the offered payment terms
 * match what the RFQ asked for; terms longer than requested are a cash-flow
 * win and score full marks.
 */
function complianceScore(
  requestedTermsDays: number,
  offeredTermsDays: number,
  supplier?: SupplierScoreInput,
): number {
  const riskScore = supplier ? RISK_SCORE_BPS[supplier.riskTier] : 5_000;
  const termsScore =
    offeredTermsDays >= requestedTermsDays
      ? BPS_ONE
      : clampBps(Math.round(((offeredTermsDays + 1) / (requestedTermsDays + 1)) * BPS_ONE));
  return clampBps(Math.round(riskScore * 0.6 + termsScore * 0.4));
}

function buildSplitAward(
  comparisons: readonly LineComparison[],
  currency: string,
  singleAward?: QuoteScorecard,
): SplitAwardRecommendation | undefined {
  const byQuote = new Map<Ulid, { supplierId: Ulid; lineNumbers: number[]; valueMinor: number }>();
  for (const comparison of comparisons) {
    if (!comparison.bestQuoteId || !comparison.bestSupplierId || !comparison.bestValue) continue;
    const entry = byQuote.get(comparison.bestQuoteId) ?? {
      supplierId: comparison.bestSupplierId,
      lineNumbers: [],
      valueMinor: 0,
    };
    entry.lineNumbers.push(comparison.rfqLineNumber);
    entry.valueMinor += comparison.bestValue.amountMinor;
    byQuote.set(comparison.bestQuoteId, entry);
  }
  if (byQuote.size === 0) return undefined;

  const awards = [...byQuote.entries()].map(([quoteId, entry]) => ({
    quoteId,
    supplierId: entry.supplierId,
    lineNumbers: entry.lineNumbers,
    value: money(entry.valueMinor, currency),
  }));
  const totalMinor = awards.reduce((total, award) => total + award.value.amountMinor, 0);
  const singleAwardValue = singleAward?.complete ? singleAward.comparableValue.amountMinor : totalMinor;
  return {
    awards,
    totalValue: money(totalMinor, currency),
    savingVsSingleAward: money(Math.max(0, singleAwardValue - totalMinor), currency),
    supplierCount: new Set(awards.map((award) => award.supplierId)).size,
  };
}

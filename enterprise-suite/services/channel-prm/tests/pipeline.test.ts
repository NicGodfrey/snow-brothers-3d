import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, type IsoDateTime, type Ulid } from "@enterprise-suite/shared-kernel";
import {
  channelFunnel,
  cohortReport,
  forecastRollup,
  isOpenDeal,
  partnerScorecards,
  periodKey,
  pipelineByPartner,
  pipelineByStage,
  pipelineByTier,
  protectionExpiryReport,
  slippedDeals,
  sourcedVsInfluenced,
  stalledDeals,
  type PipelineDeal,
  type PipelineOrder,
  type PipelineReferral,
} from "../src/domain/pipeline.js";
import { asUlid, usd } from "./helpers.js";

const NOW = "2026-03-01T00:00:00.000Z" as IsoDateTime;
const NORTHWIND = asUlid("prt_northwind");
const HELIOS = asUlid("prt_helios");

let sequence = 0;

function deal(overrides: Partial<PipelineDeal> = {}): PipelineDeal {
  sequence += 1;
  return {
    registrationId: asUlid(`reg_${sequence}`),
    number: `DR-${String(sequence).padStart(5, "0")}`,
    partnerId: NORTHWIND,
    partnerTier: "gold",
    status: "approved",
    stage: "qualified",
    probability: 25,
    value: usd(1_000_000),
    source: "partner_sourced",
    customerKey: `domain:customer-${sequence}.example`,
    productLines: ["network-security"],
    createdAt: "2026-01-01T00:00:00.000Z" as IsoDateTime,
    submittedAt: "2026-01-05T00:00:00.000Z" as IsoDateTime,
    approvedAt: "2026-01-06T00:00:00.000Z" as IsoDateTime,
    lastActivityAt: "2026-02-25T00:00:00.000Z" as IsoDateTime,
    quoteCount: 0,
    orderCount: 0,
    ...overrides,
  };
}

function order(overrides: Partial<PipelineOrder> = {}): PipelineOrder {
  sequence += 1;
  return {
    orderId: asUlid(`ord_${sequence}`),
    partnerId: NORTHWIND,
    netValue: usd(1_000_000),
    status: "placed",
    orderedAt: "2026-02-01T00:00:00.000Z" as IsoDateTime,
    sourceType: "partner_sourced",
    ...overrides,
  };
}

describe("stage and forecast roll-ups", () => {
  it("buckets open pipeline by stage, deriving weighted value and share", () => {
    const report = pipelineByStage(
      [
        deal({ stage: "qualified", probability: 25, value: usd(1_000_000) }),
        deal({ stage: "proposal", probability: 50, value: usd(2_000_000) }),
        deal({ stage: "negotiation", probability: 75, value: usd(1_000_000) }),
        deal({ stage: "closed_won", status: "closed_won", probability: 100, value: usd(5_000_000) }),
        deal({ status: "rejected", stage: "qualified" }),
      ],
      "USD",
    );

    assert.equal(report.openCount, 3, "closed and rejected deals are not open pipeline");
    assert.deepEqual(report.openValue, usd(4_000_000));
    assert.deepEqual(report.weightedValue, usd(2_000_000));

    const proposal = report.buckets.find((b) => b.stage === "proposal")!;
    assert.equal(proposal.count, 1);
    assert.deepEqual(proposal.weightedValue, usd(1_000_000));
    assert.equal(proposal.shareBps, 5_000);
    assert.equal(proposal.forecastCategory, "best_case");
    assert.equal(report.buckets.length, 4, "only the open stages get a bucket");
    assert.equal(report.buckets.reduce((sum, b) => sum + b.shareBps, 0), 10_000);
  });

  it("excludes other currencies rather than converting them", () => {
    const report = pipelineByStage(
      [deal({ value: usd(1_000_000) }), deal({ value: money(900_000, "EUR") })],
      "USD",
    );
    assert.equal(report.excludedByCurrency, 1);
    assert.equal(report.openCount, 1);
    assert.deepEqual(report.openValue, usd(1_000_000));
  });

  it("lets probability override stage when categorising the forecast", () => {
    const buckets = forecastRollup(
      [
        deal({ stage: "negotiation", probability: 20, value: usd(1_000_000) }),
        deal({ stage: "qualified", probability: 80, value: usd(2_000_000) }),
        deal({ stage: "prospect", probability: 2, value: usd(4_000_000) }),
        deal({ stage: "closed_won", status: "closed_won", value: usd(3_000_000), closedValue: usd(2_900_000) }),
      ],
      "USD",
    );
    const by = Object.fromEntries(buckets.map((b) => [b.category, b]));
    assert.deepEqual(by["pipeline"]!.value, usd(1_000_000), "a marked-down negotiation is not commit");
    assert.deepEqual(by["commit"]!.value, usd(2_000_000));
    assert.deepEqual(by["omitted"]!.value, usd(4_000_000));
    assert.deepEqual(by["closed_won"]!.value, usd(2_900_000), "won deals count at their closed value");
    assert.deepEqual(by["closed_won"]!.weightedValue, usd(2_900_000));
    assert.equal(by["best_case"]!.count, 0);
  });

  it("knows an open deal from a closed one", () => {
    assert.equal(isOpenDeal(deal({ status: "approved", stage: "proposal" })), true);
    assert.equal(isOpenDeal(deal({ status: "approved", stage: "closed_won" })), false);
    assert.equal(isOpenDeal(deal({ status: "expired", stage: "proposal" })), false);
    assert.equal(isOpenDeal(deal({ status: "draft", stage: "proposal" })), false, "a draft is not pipeline yet");
  });
});

describe("partner and tier roll-ups", () => {
  const deals = [
    deal({ partnerId: NORTHWIND, stage: "proposal", probability: 50, value: usd(2_000_000) }),
    deal({
      partnerId: NORTHWIND,
      status: "closed_won",
      stage: "closed_won",
      value: usd(4_000_000),
      closedValue: usd(3_800_000),
      submittedAt: "2026-01-01T00:00:00.000Z" as IsoDateTime,
      closedAt: "2026-02-10T00:00:00.000Z" as IsoDateTime,
    }),
    deal({ partnerId: NORTHWIND, status: "closed_lost", stage: "closed_lost", value: usd(1_000_000) }),
    deal({ partnerId: NORTHWIND, status: "rejected", approvedAt: undefined }),
    deal({ partnerId: HELIOS, partnerTier: "silver", stage: "qualified", value: usd(500_000) }),
  ];
  const orders = [
    order({ partnerId: NORTHWIND, netValue: usd(3_800_000), registrationId: asUlid("reg_2") }),
    order({ partnerId: NORTHWIND, netValue: usd(1_000_000), status: "cancelled" }),
    order({ partnerId: HELIOS, netValue: usd(250_000) }),
  ];

  it("computes win rate, approval rate, cycle time and booked value per partner", () => {
    const report = pipelineByPartner(deals, orders, "USD");
    const northwind = report.partners.find((p) => p.partnerId === NORTHWIND)!;

    assert.equal(northwind.registrationsSubmitted, 4);
    assert.equal(northwind.registrationsApproved, 3);
    assert.equal(northwind.approvalRateBps, 7_500);
    assert.equal(northwind.wonCount, 1);
    assert.equal(northwind.lostCount, 1);
    assert.equal(northwind.winRateBps, 5_000);
    assert.equal(northwind.averageCycleDays, 40);
    assert.deepEqual(northwind.wonValue, usd(3_800_000));
    assert.deepEqual(northwind.averageDealValue, usd(3_800_000));
    assert.deepEqual(northwind.bookedValue, usd(3_800_000), "cancelled orders book nothing");
    assert.equal(northwind.orderCount, 1);
    assert.deepEqual(northwind.openValue, usd(2_000_000));
    assert.deepEqual(northwind.weightedValue, usd(1_000_000));
    assert.deepEqual(report.totals.bookedValue, usd(4_050_000));
  });

  it("rolls partners up by tier", () => {
    const tiers = pipelineByTier(pipelineByPartner(deals, orders, "USD"));
    const gold = tiers.find((t) => t.tier === "gold")!;
    const silver = tiers.find((t) => t.tier === "silver")!;
    assert.equal(gold.partnerCount, 1);
    assert.equal(gold.winRateBps, 5_000);
    assert.deepEqual(silver.openValue, usd(500_000));
    assert.equal(silver.winRateBps, 0, "no closed deals means no win rate to report");
  });

  it("scores partners out of 100 with an explainable breakdown", () => {
    const report = pipelineByPartner(deals, orders, "USD");
    const scorecards = partnerScorecards({
      report,
      conflictsByPartner: new Map([[NORTHWIND, 2]]),
      bookedValueTargetMinor: 3_800_000,
    });
    const northwind = scorecards.find((s) => s.partnerId === NORTHWIND)!;
    const components = Object.fromEntries(northwind.components.map((c) => [c.name, c.points]));

    assert.equal(components["revenue"], 40, "hitting the target earns full revenue marks");
    assert.equal(components["win_rate"], 13);
    assert.equal(components["registration_quality"], 15);
    assert.equal(components["speed"], 9);
    assert.equal(components["conduct"], 3, "two conflict cases cost two points");
    assert.equal(northwind.score, 80);
    assert.equal(northwind.conflictCount, 2);
    assert.deepEqual(
      scorecards.map((s) => s.score),
      [...scorecards.map((s) => s.score)].sort((a, b) => b - a),
      "best partner first",
    );
  });
});

describe("funnel, expiry, attribution and cohorts", () => {
  it("converts step by step from referral to won deal", () => {
    const referrals: PipelineReferral[] = [
      { referralId: asUlid("ref_1"), partnerId: NORTHWIND, status: "converted", submittedAt: NOW, acceptedAt: NOW },
      { referralId: asUlid("ref_2"), partnerId: NORTHWIND, status: "rejected", submittedAt: NOW },
    ];
    const deals = [
      deal({ quoteCount: 1, status: "closed_won", stage: "closed_won" }),
      deal({ quoteCount: 0 }),
      deal({ submittedAt: undefined, approvedAt: undefined, status: "draft" }),
    ];
    const funnel = channelFunnel(deals, referrals, [order(), order({ status: "cancelled" })]);
    const steps = Object.fromEntries(funnel.steps.map((s) => [s.step, s]));

    assert.equal(steps["referrals_submitted"]!.count, 2);
    assert.equal(steps["referrals_accepted"]!.conversionBps, 5_000);
    assert.equal(steps["registrations_submitted"]!.count, 2);
    assert.equal(steps["deals_quoted"]!.count, 1);
    assert.equal(steps["deals_ordered"]!.count, 1, "cancelled orders drop out of the funnel");
    assert.equal(steps["deals_won"]!.count, 1);
    assert.equal(funnel.endToEndBps, 5_000);
  });

  it("buckets protection by how soon it lapses and flags what already has", () => {
    const report = protectionExpiryReport(
      [
        deal({ number: "DR-A", protectionEndsAt: "2026-03-05T00:00:00.000Z" as IsoDateTime, value: usd(1_000_000) }),
        deal({ number: "DR-B", protectionEndsAt: "2026-03-12T00:00:00.000Z" as IsoDateTime, value: usd(2_000_000) }),
        deal({ number: "DR-C", protectionEndsAt: "2026-04-20T00:00:00.000Z" as IsoDateTime, value: usd(4_000_000) }),
        deal({ number: "DR-D", protectionEndsAt: "2026-02-01T00:00:00.000Z" as IsoDateTime }),
        deal({ number: "DR-E", status: "closed_won", protectionEndsAt: "2026-03-03T00:00:00.000Z" as IsoDateTime }),
      ],
      NOW,
      "USD",
    );
    const buckets = Object.fromEntries(report.buckets.map((b) => [b.label, b]));

    assert.deepEqual(buckets["0-7d"]!.registrationNumbers, ["DR-A"]);
    assert.deepEqual(buckets["8-14d"]!.registrationNumbers, ["DR-B"]);
    assert.deepEqual(buckets["30d+"]!.registrationNumbers, ["DR-C"]);
    assert.deepEqual(report.lapsedUnclosed, ["DR-D"], "approved but out of protection needs a decision");
    assert.deepEqual(report.atRiskValue, usd(3_000_000), "everything lapsing inside a fortnight");
    assert.equal(buckets["30d+"]!.toDays, -1, "the open-ended bucket reports -1 rather than Infinity");
  });

  it("splits revenue by source without double-counting co-sell", () => {
    const split = sourcedVsInfluenced(
      [
        order({ sourceType: "partner_sourced", netValue: usd(6_000_000) }),
        order({ sourceType: "vendor_sourced", netValue: usd(3_000_000) }),
        order({ sourceType: "co_sell", netValue: usd(1_000_000) }),
        order({ sourceType: "partner_sourced", netValue: usd(5_000_000), status: "cancelled" }),
        order({ sourceType: "partner_sourced", netValue: money(9_000_000, "EUR") }),
      ],
      "USD",
    );
    assert.deepEqual(split.partnerSourced, usd(6_000_000));
    assert.deepEqual(split.vendorSourced, usd(3_000_000));
    assert.deepEqual(split.coSell, usd(1_000_000));
    assert.deepEqual(split.total, usd(10_000_000));
    assert.equal(split.partnerSourcedShareBps, 6_000);
    assert.equal(split.orderCount, 3);
    assert.equal(split.excludedByCurrency, 1);
  });

  it("cohorts registrations by the period they were submitted in", () => {
    assert.equal(periodKey("2026-02-14T00:00:00.000Z" as IsoDateTime, "month"), "2026-02");
    assert.equal(periodKey("2026-02-14T00:00:00.000Z" as IsoDateTime, "quarter"), "2026-Q1");

    const cohorts = cohortReport(
      [
        deal({ submittedAt: "2026-01-10T00:00:00.000Z" as IsoDateTime, status: "closed_won", stage: "closed_won", value: usd(1_000_000), closedValue: usd(1_100_000) }),
        deal({ submittedAt: "2026-01-20T00:00:00.000Z" as IsoDateTime, status: "closed_lost", stage: "closed_lost", value: usd(2_000_000) }),
        deal({ submittedAt: "2026-02-02T00:00:00.000Z" as IsoDateTime, status: "approved", value: usd(3_000_000) }),
        deal({ submittedAt: undefined, status: "draft" }),
      ],
      "month",
      "USD",
    );
    assert.deepEqual(cohorts.map((c) => c.period), ["2026-01", "2026-02"]);
    const january = cohorts[0]!;
    assert.equal(january.registrations, 2);
    assert.equal(january.won, 1);
    assert.equal(january.lost, 1);
    assert.equal(january.conversionBps, 5_000);
    assert.deepEqual(january.wonValue, usd(1_100_000));
    assert.deepEqual(january.registeredValue, usd(3_000_000));
    assert.equal(cohorts[1]!.open, 1);
  });
});

describe("pipeline hygiene", () => {
  it("flags open deals idle beyond what their stage tolerates", () => {
    const stalled = stalledDeals(
      [
        deal({ number: "DR-STALE", stage: "negotiation", lastActivityAt: "2026-02-01T00:00:00.000Z" as IsoDateTime }),
        deal({ number: "DR-FRESH", stage: "negotiation", lastActivityAt: "2026-02-27T00:00:00.000Z" as IsoDateTime }),
        deal({ number: "DR-SLOW-OK", stage: "qualified", lastActivityAt: "2026-02-10T00:00:00.000Z" as IsoDateTime }),
        deal({ number: "DR-CLOSED", status: "closed_won", stage: "closed_won", lastActivityAt: "2025-01-01T00:00:00.000Z" as IsoDateTime }),
      ],
      NOW,
    );
    assert.deepEqual(stalled.map((d) => d.number), ["DR-STALE"]);
    assert.equal(stalled[0]!.idleDays, 28);
    assert.equal(stalled[0]!.thresholdDays, 14);
  });

  it("flags open deals whose expected close date has passed", () => {
    const overdue = deal({ number: "DR-SLIP" });
    const onTime = deal({ number: "DR-ONTIME" });
    const expected = new Map<Ulid, IsoDateTime>([
      [overdue.registrationId, "2026-02-01T00:00:00.000Z" as IsoDateTime],
      [onTime.registrationId, "2026-06-01T00:00:00.000Z" as IsoDateTime],
    ]);
    const slipped = slippedDeals([overdue, onTime], NOW, expected);
    assert.deepEqual(slipped.map((d) => d.number), ["DR-SLIP"]);
    assert.equal(slipped[0]!.overdueDays, 28);
  });
});

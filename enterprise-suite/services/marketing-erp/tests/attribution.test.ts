import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, money, newId, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import {
  allocateCredit,
  computeAttributionReport,
  modelWeights,
  splitMoneyByWeights,
} from "../src/domain/attribution.js";
import { Touchpoint } from "../src/domain/touchpoint.js";

const tenant = tenantId("t_attr");

function touch(occurredAt: string, campaignId?: string, channelId?: string): Touchpoint {
  return Touchpoint.record({
    tenantId: tenant,
    leadId: newId("lead"),
    touchType: "click",
    occurredAt: brand<string, "IsoDateTime">(occurredAt) as IsoDateTime,
    campaignId: campaignId ? (campaignId as Touchpoint["campaignId"]) : undefined,
    channelId: channelId ? (channelId as Touchpoint["channelId"]) : undefined,
  });
}

describe("model weights", () => {
  it("single touchpoint gets full credit under every model", () => {
    assert.deepEqual(modelWeights("first_touch", 1), [1]);
    assert.deepEqual(modelWeights("last_touch", 1), [1]);
    assert.deepEqual(modelWeights("linear", 1), [1]);
    assert.deepEqual(modelWeights("position_based", 1), [1]);
  });

  it("first touch puts 100% on the earliest", () => {
    assert.deepEqual(modelWeights("first_touch", 4), [1, 0, 0, 0]);
  });

  it("last touch puts 100% on the latest", () => {
    assert.deepEqual(modelWeights("last_touch", 3), [0, 0, 1]);
  });

  it("linear splits evenly", () => {
    const weights = modelWeights("linear", 4);
    assert.equal(weights.length, 4);
    for (const w of weights) assert.ok(Math.abs(w - 0.25) < 1e-12);
  });

  it("position based gives 40/20/40 with middle shared", () => {
    assert.deepEqual(modelWeights("position_based", 2), [0.5, 0.5]);
    const five = modelWeights("position_based", 5);
    assert.ok(Math.abs(five[0]! - 0.4) < 1e-12);
    assert.ok(Math.abs(five[4]! - 0.4) < 1e-12);
    for (const middle of five.slice(1, 4)) {
      assert.ok(Math.abs(middle - 0.2 / 3) < 1e-12);
    }
    assert.ok(Math.abs(five.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  });
});

describe("money splitting", () => {
  it("splits without losing or minting minor units", () => {
    const shares = splitMoneyByWeights(money(100, "USD"), [1 / 3, 1 / 3, 1 / 3]);
    assert.deepEqual(
      shares.map((s) => s.amountMinor),
      [34, 33, 33],
    );
    assert.equal(shares.reduce((sum, s) => sum + s.amountMinor, 0), 100);
  });

  it("handles skewed weights", () => {
    const shares = splitMoneyByWeights(money(999, "EUR"), [0.4, 0.2, 0.4]);
    assert.equal(shares.reduce((sum, s) => sum + s.amountMinor, 0), 999);
    assert.ok(shares[0]!.amountMinor >= 399);
    assert.ok(shares[1]!.amountMinor >= 199);
  });
});

describe("allocateCredit", () => {
  const journey = [
    touch("2026-08-01T10:00:00.000Z", "camp_a", "chan_search"),
    touch("2026-08-03T10:00:00.000Z", "camp_b", "chan_email"),
    touch("2026-08-05T10:00:00.000Z", "camp_a", "chan_webinar"),
  ];

  it("orders touchpoints by time regardless of input order", () => {
    const shuffled = [journey[2]!, journey[0]!, journey[1]!];
    const allocations = allocateCredit("first_touch", shuffled, money(10_000, "USD"));
    assert.equal(allocations[0]!.campaignId, "camp_a");
    assert.equal(allocations[0]!.credited.amountMinor, 10_000);
    assert.equal(allocations[1]!.credited.amountMinor, 0);
  });

  it("last touch credits the final touchpoint", () => {
    const allocations = allocateCredit("last_touch", journey, money(10_000, "USD"));
    assert.equal(allocations[2]!.channelId, "chan_webinar");
    assert.equal(allocations[2]!.credited.amountMinor, 10_000);
  });

  it("linear distributes 10000 over 3 touches as 3334/3333/3333", () => {
    const allocations = allocateCredit("linear", journey, money(10_000, "USD"));
    assert.deepEqual(
      allocations.map((a) => a.credited.amountMinor),
      [3334, 3333, 3333],
    );
  });

  it("refuses empty journeys", () => {
    assert.throws(() => allocateCredit("linear", [], money(100, "USD")), /touchpoints/);
  });
});

describe("computeAttributionReport", () => {
  it("aggregates credit per campaign and channel across conversions", () => {
    const conversions = [
      {
        leadId: newId("lead"),
        value: money(10_000, "USD"),
        touchpoints: [
          touch("2026-08-01T00:00:00.000Z", "camp_a", "chan_search"),
          touch("2026-08-02T00:00:00.000Z", "camp_b", "chan_email"),
        ],
      },
      {
        leadId: newId("lead"),
        value: money(6_000, "USD"),
        touchpoints: [touch("2026-08-03T00:00:00.000Z", "camp_b", "chan_email")],
      },
    ];

    const linear = computeAttributionReport("linear", conversions);
    assert.equal(linear.totalRevenueMinor, 16_000);
    assert.equal(linear.conversionCount, 2);
    const campA = linear.byCampaign.find((b) => b.key === "camp_a")!;
    const campB = linear.byCampaign.find((b) => b.key === "camp_b")!;
    assert.equal(campA.creditedMinor, 5_000);
    assert.equal(campB.creditedMinor, 11_000);
    assert.ok(Math.abs(campA.share - 5_000 / 16_000) < 1e-12);

    const first = computeAttributionReport("first_touch", conversions);
    assert.equal(first.byCampaign.find((b) => b.key === "camp_a")!.creditedMinor, 10_000);
    assert.equal(first.byCampaign.find((b) => b.key === "camp_b")!.creditedMinor, 6_000);

    const last = computeAttributionReport("last_touch", conversions);
    assert.equal(last.byCampaign.find((b) => b.key === "camp_b")!.creditedMinor, 16_000);
    // camp_a was touched but earns nothing under last-touch: present with zero credit.
    const campALast = last.byCampaign.find((b) => b.key === "camp_a")!;
    assert.equal(campALast.creditedMinor, 0);
    assert.equal(campALast.share, 0);
    assert.equal(campALast.touchpointCount, 1);
  });

  it("total credited always equals total conversion value", () => {
    const conversions = [
      {
        leadId: newId("lead"),
        value: money(9_999, "USD"),
        touchpoints: [
          touch("2026-08-01T00:00:00.000Z", "camp_a"),
          touch("2026-08-02T00:00:00.000Z", "camp_b"),
          touch("2026-08-03T00:00:00.000Z", "camp_c"),
        ],
      },
    ];
    for (const model of ["first_touch", "last_touch", "linear", "position_based"] as const) {
      const report = computeAttributionReport(model, conversions);
      const credited = report.byCampaign.reduce((sum, b) => sum + b.creditedMinor, 0);
      assert.equal(credited, 9_999, `model ${model} lost minor units`);
    }
  });

  it("rejects mixed currencies", () => {
    const conversions = [
      {
        leadId: newId("lead"),
        value: money(100, "USD"),
        touchpoints: [touch("2026-08-01T00:00:00.000Z", "camp_a")],
      },
      {
        leadId: newId("lead"),
        value: money(100, "EUR"),
        touchpoints: [touch("2026-08-02T00:00:00.000Z", "camp_b")],
      },
    ];
    assert.throws(() => computeAttributionReport("linear", conversions), /Mixed currencies/);
  });
});

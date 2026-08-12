import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import {
  computeSafetyStock,
  inverseNormalCdf,
  parseSafetyStockMethod,
  SafetyStockPolicy,
  weeklyStdDev,
} from "../src/domain/safety-stock.js";

describe("inverse normal CDF", () => {
  it("matches known z-factors to 4 decimal places", () => {
    const cases: [number, number][] = [
      [0.5, 0],
      [0.8413447, 1.0],
      [0.9, 1.2816],
      [0.95, 1.6449],
      [0.975, 1.96],
      [0.99, 2.3263],
      [0.999, 3.0902],
    ];
    for (const [p, expected] of cases) {
      assert.ok(Math.abs(inverseNormalCdf(p) - expected) < 5e-4, `z(${p}) ~ ${expected}, got ${inverseNormalCdf(p)}`);
    }
  });

  it("rejects probabilities outside (0, 1)", () => {
    assert.throws(() => inverseNormalCdf(0), /open interval/);
    assert.throws(() => inverseNormalCdf(1), /open interval/);
  });
});

describe("safety stock computation", () => {
  const ctx = { avgWeeklyDemand: 70, weeklyDemandStdDev: 12, leadTimeDays: 14 };

  it("STATIC returns the fixed quantity", () => {
    assert.equal(computeSafetyStock({ type: "STATIC", qty: 42 }, ctx), 42);
  });

  it("DAYS_OF_COVER converts weekly demand to daily coverage", () => {
    // 70/week = 10/day; 5 days of cover = 50
    assert.equal(computeSafetyStock({ type: "DAYS_OF_COVER", days: 5 }, ctx), 50);
  });

  it("SERVICE_LEVEL applies z * sigma * sqrt(leadTimeWeeks)", () => {
    // z(0.95)=1.6449, sigma=12, LT=2 weeks -> 1.6449*12*sqrt(2) = 27.914
    const ss = computeSafetyStock({ type: "SERVICE_LEVEL", serviceLevel: 0.95 }, ctx);
    assert.ok(Math.abs(ss - 27.914) < 0.01, `expected ~27.914, got ${ss}`);
  });

  it("SERVICE_LEVEL prefers the policy's own std-dev override", () => {
    const ss = computeSafetyStock(
      { type: "SERVICE_LEVEL", serviceLevel: 0.95, weeklyDemandStdDev: 24 },
      ctx,
    );
    assert.ok(Math.abs(ss - 55.828) < 0.01, `expected ~55.828, got ${ss}`);
  });

  it("SERVICE_LEVEL yields zero for deterministic demand", () => {
    assert.equal(
      computeSafetyStock({ type: "SERVICE_LEVEL", serviceLevel: 0.95 }, { ...ctx, weeklyDemandStdDev: 0 }),
      0,
    );
  });

  it("computes sample standard deviation of a series", () => {
    assert.equal(weeklyStdDev([10, 10, 10]), 0);
    assert.ok(Math.abs(weeklyStdDev([4, 8, 6, 10]) - 2.582) < 0.001);
    assert.equal(weeklyStdDev([5]), 0);
  });

  it("validates method shapes", () => {
    assert.throws(() => parseSafetyStockMethod({ type: "SERVICE_LEVEL", serviceLevel: 0.4 }), /serviceLevel/);
    assert.throws(() => parseSafetyStockMethod({ type: "DAYS_OF_COVER", days: 0 }), /days/);
    assert.throws(() => parseSafetyStockMethod({ type: "NOPE" }), /Unknown safety stock method/);
  });

  it("policy aggregate guards its name and emits change events", () => {
    const tenant = tenantId("t1");
    const policy = SafetyStockPolicy.create(tenant, {
      name: "A items 95% SL",
      method: { type: "SERVICE_LEVEL", serviceLevel: 0.95 },
    });
    const events = policy.pullEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].eventType, "supplychain.safety_stock_policy.changed");
    assert.throws(() => SafetyStockPolicy.create(tenant, { name: "  ", method: { type: "STATIC", qty: 1 } }), /name/);
    policy.changeMethod({ type: "STATIC", qty: 10 });
    assert.equal(policy.compute({ avgWeeklyDemand: 0, weeklyDemandStdDev: 0, leadTimeDays: 0 }), 10);
  });
});

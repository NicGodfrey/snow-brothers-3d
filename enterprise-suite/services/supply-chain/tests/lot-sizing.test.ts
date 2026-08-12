import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyLotSizing, coverageLookaheadPeriods, parseLotSizingRule } from "../src/domain/lot-sizing.js";

describe("lot sizing", () => {
  it("parses and validates each rule shape", () => {
    assert.deepEqual(parseLotSizingRule({ type: "LOT_FOR_LOT" }), { type: "LOT_FOR_LOT" });
    assert.deepEqual(parseLotSizingRule({ type: "FIXED_ORDER_QTY", fixedQty: 50 }), {
      type: "FIXED_ORDER_QTY",
      fixedQty: 50,
    });
    assert.throws(() => parseLotSizingRule({ type: "FIXED_ORDER_QTY", fixedQty: 0 }), /fixedQty/);
    assert.throws(() => parseLotSizingRule({ type: "MIN_MAX", minQty: 100, maxQty: 50 }), /maxQty/);
    assert.throws(() => parseLotSizingRule({ type: "PERIOD_ORDER_QTY", periods: 0 }), /periods/);
    assert.throws(() => parseLotSizingRule({ type: "EOQ" }), /Unknown lot sizing type/);
  });

  it("LOT_FOR_LOT orders exactly the need", () => {
    assert.equal(applyLotSizing({ type: "LOT_FOR_LOT" }, 37.25).qty, 37.25);
    assert.equal(applyLotSizing({ type: "LOT_FOR_LOT" }, 0).qty, 0);
  });

  it("FIXED_ORDER_QTY rounds up to full lots", () => {
    const rule = { type: "FIXED_ORDER_QTY", fixedQty: 50 } as const;
    assert.equal(applyLotSizing(rule, 1).qty, 50);
    assert.equal(applyLotSizing(rule, 50).qty, 50);
    assert.equal(applyLotSizing(rule, 51).qty, 100);
    assert.equal(applyLotSizing(rule, 149.999).qty, 150);
  });

  it("MIN_MAX respects minimum, multiple and cap", () => {
    const rule = { type: "MIN_MAX", minQty: 20, multiple: 10, maxQty: 60 } as const;
    assert.equal(applyLotSizing(rule, 5).qty, 20); // min wins
    assert.equal(applyLotSizing(rule, 33).qty, 40); // rounded to multiple
    assert.equal(applyLotSizing(rule, 58).qty, 60); // capped
  });

  it("MIN_MAX orders past the cap with a warning when the need exceeds it", () => {
    const rule = { type: "MIN_MAX", minQty: 20, multiple: 10, maxQty: 60 } as const;
    const decision = applyLotSizing(rule, 75);
    assert.equal(decision.qty, 80); // need honoured, rounded to multiple
    assert.equal(decision.warnings.length, 1);
    assert.match(decision.warnings[0], /exceeds maximum lot size/);
  });

  it("PERIOD_ORDER_QTY defers coverage math to the netting engine", () => {
    assert.equal(coverageLookaheadPeriods({ type: "PERIOD_ORDER_QTY", periods: 4 }), 3);
    assert.equal(coverageLookaheadPeriods({ type: "LOT_FOR_LOT" }), 0);
    assert.equal(applyLotSizing({ type: "PERIOD_ORDER_QTY", periods: 4 }, 120).qty, 120);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeAtp, computeCtp } from "../src/domain/atp.js";
import { addDays, isoDate, makeWeeklyCalendar } from "../src/domain/calendar.js";

const calendar = makeWeeklyCalendar(isoDate("2026-08-10"), 6);

describe("discrete ATP", () => {
  it("segments supply and consumes committed demand until the next supply bucket", () => {
    const rows = computeAtp({
      calendar,
      onHand: 40,
      supply: [0, 0, 60, 0, 0, 0],
      demand: [10, 20, 30, 10, 0, 0],
    });
    // segment 1 (t0..t1): 40 - (10+20) = 10; segment 2 (t2..t5): 60 - 40 = 20
    assert.deepEqual(rows.map((r) => r.atp), [10, 0, 20, 0, 0, 0]);
    assert.deepEqual(rows.map((r) => r.cumulativeAtp), [10, 10, 30, 30, 30, 30]);
  });

  it("consumes backwards when later demand exceeds later supply", () => {
    const rows = computeAtp({
      calendar,
      onHand: 50,
      supply: [0, 0, 20, 0, 0, 0],
      demand: [0, 10, 45, 0, 0, 0],
    });
    // segment 2: 20 - 45 = -25 -> borrow from segment 1: 40 - 25 = 15
    assert.deepEqual(rows.map((r) => r.atp), [15, 0, 0, 0, 0, 0]);
    assert.equal(rows.at(-1)?.cumulativeAtp, 15);
  });

  it("keeps an uncoverable deficit visible in the first bucket", () => {
    const rows = computeAtp({
      calendar,
      onHand: 10,
      supply: [0, 0, 0, 0, 0, 0],
      demand: [30, 0, 0, 0, 0, 0],
    });
    assert.equal(rows[0].atp, -20);
  });
});

describe("CTP", () => {
  const atpRows = computeAtp({
    calendar,
    onHand: 30,
    supply: [0, 0, 40, 0, 0, 0],
    demand: [20, 0, 10, 0, 0, 0],
  });
  // ATP: segment1 30-20=10 at t0; segment2 40-10=30 at t2; cum: [10,10,40,...]

  it("promises the requested date when ATP covers it", () => {
    const result = computeCtp(atpRows, { qty: 10, needDate: isoDate("2026-08-12") }, {
      leadTimeDays: 7,
      capacity: [],
      addDays,
    });
    assert.equal(result.canPromise, true);
    assert.equal(result.promiseDate, "2026-08-12");
    assert.equal(result.qtyFromAtp, 10);
    assert.equal(result.qtyFromNewSupply, 0);
  });

  it("moves the promise to the week where cumulative ATP suffices", () => {
    const result = computeCtp(atpRows, { qty: 35, needDate: isoDate("2026-08-12") }, {
      leadTimeDays: 7,
      capacity: [],
      addDays,
    });
    assert.equal(result.canPromise, true);
    assert.equal(result.promiseDate, "2026-08-24"); // t2, where cum ATP = 40
  });

  it("uses supplier capacity plus lead time when ATP is exhausted", () => {
    const result = computeCtp(atpRows, { qty: 60, needDate: isoDate("2026-08-12") }, {
      leadTimeDays: 14,
      capacity: [
        { weekStart: isoDate("2026-08-10"), availableQty: 15 },
        { weekStart: isoDate("2026-08-17"), availableQty: 15 },
      ],
      addDays,
    });
    // 40 from ATP, remaining 20 accumulates by week 2026-08-17 + 14d lead
    assert.equal(result.canPromise, true);
    assert.equal(result.qtyFromAtp, 40);
    assert.equal(result.qtyFromNewSupply, 20);
    assert.equal(result.promiseDate, "2026-08-31");
  });

  it("declines when neither ATP nor capacity can cover", () => {
    const result = computeCtp(atpRows, { qty: 500, needDate: isoDate("2026-08-12") }, {
      leadTimeDays: 7,
      capacity: [{ weekStart: isoDate("2026-08-10"), availableQty: 10 }],
      addDays,
    });
    assert.equal(result.canPromise, false);
    assert.equal(result.promiseDate, null);
    assert.match(result.detail, /Cannot promise/);
  });
});

/**
 * Date bucketing. Almost every wrong number in a BI system is a wrong bucket,
 * and the interesting cases are all at boundaries: ISO weeks that belong to
 * the neighbouring year, month arithmetic that would overflow a short month,
 * and comparison windows that have to shift by whole periods.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addPeriods,
  bucketStart,
  comparisonRange,
  countPeriods,
  enumeratePeriods,
  inRange,
  isoWeek,
  parseInstant,
  periodKey,
  periodLabel,
  periodStart,
  timeRange,
  trailingRange,
} from "../src/domain/time-grain.js";
import { QueryError } from "../src/domain/errors.js";
import { instant } from "./helpers.js";

describe("period keys", () => {
  it("buckets an instant at each grain", () => {
    const at = instant("2026-08-12T14:37:29.123Z");
    assert.equal(periodKey(bucketStart(at, "hour"), "hour"), "2026-08-12T14");
    assert.equal(periodKey(bucketStart(at, "day"), "day"), "2026-08-12");
    assert.equal(periodKey(bucketStart(at, "week"), "week"), "2026-W33");
    assert.equal(periodKey(bucketStart(at, "month"), "month"), "2026-08");
    assert.equal(periodKey(bucketStart(at, "quarter"), "quarter"), "2026-Q3");
    assert.equal(periodKey(bucketStart(at, "year"), "year"), "2026");
  });

  it("starts weeks on Monday", () => {
    // 2026-08-12 is a Wednesday.
    assert.equal(bucketStart(instant("2026-08-12T23:59:59Z"), "week"), "2026-08-10T00:00:00.000Z");
    assert.equal(bucketStart(instant("2026-08-10T00:00:00Z"), "week"), "2026-08-10T00:00:00.000Z");
    assert.equal(bucketStart(instant("2026-08-16T23:00:00Z"), "week"), "2026-08-10T00:00:00.000Z");
  });

  it("uses the ISO week-numbering year, not the calendar year", () => {
    // 1 Jan 2027 is a Friday, so it belongs to week 53 of 2026.
    assert.deepEqual(isoWeek(new Date("2027-01-01T00:00:00Z")), { year: 2026, week: 53 });
    assert.equal(periodKey(instant("2027-01-01T00:00:00Z"), "week"), "2026-W53");
    // 4 Jan is always in week 1.
    assert.equal(periodKey(instant("2027-01-04T00:00:00Z"), "week"), "2027-W01");
  });

  it("round-trips keys back to their starting instant", () => {
    const cases = [
      ["hour", "2026-08-12T14"],
      ["day", "2026-08-12"],
      ["week", "2026-W33"],
      ["month", "2026-08"],
      ["quarter", "2026-Q3"],
      ["year", "2026"],
    ] as const;
    for (const [grain, key] of cases) {
      assert.equal(periodKey(periodStart(key, grain), grain), key, grain);
    }
  });

  it("round-trips a week key that straddles the year boundary", () => {
    assert.equal(periodStart("2026-W53", "week"), "2026-12-28T00:00:00.000Z");
    assert.equal(periodKey(periodStart("2026-W53", "week"), "week"), "2026-W53");
  });

  it("labels periods for humans", () => {
    assert.equal(periodLabel("2026-08", "month"), "Aug 2026");
    assert.equal(periodLabel("2026-W33", "week"), "W33 2026");
    assert.equal(periodLabel("2026-Q3", "quarter"), "Q3 2026");
    assert.equal(periodLabel("2026-08-12T14", "hour"), "2026-08-12 14:00 UTC");
  });
});

describe("calendar arithmetic", () => {
  it("clamps month arithmetic to the last valid day", () => {
    assert.equal(addPeriods(instant("2026-01-31T00:00:00Z"), "month", 1), "2026-02-28T00:00:00.000Z");
    assert.equal(addPeriods(instant("2028-01-31T00:00:00Z"), "month", 1), "2028-02-29T00:00:00.000Z");
    assert.equal(addPeriods(instant("2026-03-31T00:00:00Z"), "month", -1), "2026-02-28T00:00:00.000Z");
  });

  it("crosses year boundaries in both directions", () => {
    assert.equal(addPeriods(instant("2026-11-15T00:00:00Z"), "quarter", 1), "2027-02-15T00:00:00.000Z");
    assert.equal(addPeriods(instant("2026-02-15T00:00:00Z"), "month", -3), "2025-11-15T00:00:00.000Z");
  });

  it("counts whole periods in a range, rounding up", () => {
    const range = timeRange("2026-01-01", "2026-04-01");
    assert.equal(countPeriods(range, "month"), 3);
    assert.equal(countPeriods(range, "quarter"), 1);
    assert.equal(countPeriods(range, "day"), 90);
    // A range shorter than one unit still counts as one.
    assert.equal(countPeriods(timeRange("2026-01-01", "2026-01-02"), "month"), 1);
  });
});

describe("ranges", () => {
  it("is half-open: the end instant is excluded", () => {
    const range = timeRange("2026-08-01", "2026-09-01");
    assert.equal(inRange(instant("2026-08-01T00:00:00Z"), range), true);
    assert.equal(inRange(instant("2026-08-31T23:59:59.999Z"), range), true);
    assert.equal(inRange(instant("2026-09-01T00:00:00Z"), range), false);
  });

  it("accepts date-only strings as UTC midnight and rejects nonsense", () => {
    assert.equal(parseInstant("2026-08-12"), "2026-08-12T00:00:00.000Z");
    assert.throws(() => parseInstant("last tuesday"), QueryError);
    assert.throws(() => timeRange("2026-09-01", "2026-08-01"), QueryError);
  });

  it("shifts a comparison window by its own length or by a year", () => {
    const range = timeRange("2026-07-01", "2026-09-01");
    assert.deepEqual(comparisonRange(range, "month", "previous-period"), {
      from: "2026-05-01T00:00:00.000Z",
      toExclusive: "2026-07-01T00:00:00.000Z",
    });
    assert.deepEqual(comparisonRange(range, "month", "previous-year"), {
      from: "2025-07-01T00:00:00.000Z",
      toExclusive: "2025-09-01T00:00:00.000Z",
    });
  });

  it("enumerates every period in a range, gaps included", () => {
    const periods = enumeratePeriods(timeRange("2026-06-01", "2026-09-01"), "month");
    assert.deepEqual(periods, ["2026-06", "2026-07", "2026-08"]);
    assert.equal(enumeratePeriods(timeRange("2026-01-01", "2027-01-01"), "day").length, 365);
  });

  it("caps enumeration so a bad grain cannot spin", () => {
    const periods = enumeratePeriods(timeRange("2020-01-01", "2030-01-01"), "hour", 50);
    assert.equal(periods.length, 50);
  });

  it("builds a trailing window that includes the anchor's own period", () => {
    const range = trailingRange(instant("2026-08-12T09:00:00Z"), "month", 3);
    assert.deepEqual(range, {
      from: "2026-06-01T00:00:00.000Z",
      toExclusive: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(countPeriods(range, "month"), 3);
    assert.throws(() => trailingRange(instant("2026-08-12T09:00:00Z"), "month", 0), QueryError);
  });
});

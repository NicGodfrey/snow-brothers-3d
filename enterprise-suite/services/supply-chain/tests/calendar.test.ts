import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addDays,
  bucketIndexOf,
  bucketize,
  clampedBucketIndexOf,
  diffDays,
  isoDate,
  makeWeeklyCalendar,
  startOfIsoWeek,
} from "../src/domain/calendar.js";

describe("calendar", () => {
  it("validates ISO dates strictly", () => {
    assert.equal(isoDate("2026-08-10"), "2026-08-10");
    assert.throws(() => isoDate("2026-8-10"), /Invalid ISO date/);
    assert.throws(() => isoDate("2026-02-30"), /Invalid ISO date/);
    assert.throws(() => isoDate("not-a-date"), /Invalid ISO date/);
  });

  it("normalizes any day to the Monday of its ISO week", () => {
    assert.equal(startOfIsoWeek(isoDate("2026-08-10")), "2026-08-10"); // Monday
    assert.equal(startOfIsoWeek(isoDate("2026-08-12")), "2026-08-10"); // Wednesday
    assert.equal(startOfIsoWeek(isoDate("2026-08-16")), "2026-08-10"); // Sunday
    assert.equal(startOfIsoWeek(isoDate("2026-08-17")), "2026-08-17"); // next Monday
  });

  it("does date arithmetic across month boundaries", () => {
    assert.equal(addDays(isoDate("2026-08-28"), 7), "2026-09-04");
    assert.equal(addDays(isoDate("2026-01-01"), -1), "2025-12-31");
    assert.equal(diffDays(isoDate("2026-08-01"), isoDate("2026-09-01")), 31);
  });

  it("builds weekly calendars anchored to Monday", () => {
    const cal = makeWeeklyCalendar(isoDate("2026-08-12"), 4);
    assert.equal(cal.start, "2026-08-10");
    assert.deepEqual(cal.weekStarts, ["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
    assert.equal(cal.end, "2026-09-07");
    assert.throws(() => makeWeeklyCalendar(isoDate("2026-08-12"), 0), /between 1 and 104/);
  });

  it("maps dates to bucket indexes with out-of-horizon signalling", () => {
    const cal = makeWeeklyCalendar(isoDate("2026-08-10"), 4);
    assert.equal(bucketIndexOf(cal, isoDate("2026-08-10")), 0);
    assert.equal(bucketIndexOf(cal, isoDate("2026-08-16")), 0);
    assert.equal(bucketIndexOf(cal, isoDate("2026-08-17")), 1);
    assert.equal(bucketIndexOf(cal, isoDate("2026-08-09")), -1);
    assert.equal(bucketIndexOf(cal, isoDate("2026-09-07")), 4); // beyond horizon
    assert.equal(clampedBucketIndexOf(cal, isoDate("2026-08-01")), 0);
    assert.equal(clampedBucketIndexOf(cal, isoDate("2027-01-01")), 3);
  });

  it("bucketizes dated quantities, optionally folding past-due into bucket 0", () => {
    const cal = makeWeeklyCalendar(isoDate("2026-08-10"), 3);
    const entries = [
      { date: isoDate("2026-08-05"), qty: 10 }, // past due
      { date: isoDate("2026-08-11"), qty: 5 },
      { date: isoDate("2026-08-18"), qty: 7 },
      { date: isoDate("2026-12-01"), qty: 99 }, // beyond horizon
    ];
    assert.deepEqual(bucketize(cal, entries), [5, 7, 0]);
    assert.deepEqual(bucketize(cal, entries, { includePastDueInFirstBucket: true }), [15, 7, 0]);
  });
});

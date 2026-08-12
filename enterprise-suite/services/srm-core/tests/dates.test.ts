import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addDays,
  addMonths,
  assertWindow,
  dateOnly,
  daysBetween,
  isDateOnly,
  maxDate,
  minDate,
  windowContains,
  windowsOverlap,
} from "../src/domain/dates.js";
import {
  comparePeriods,
  makePeriod,
  nextPeriod,
  parsePeriod,
  periodContaining,
  periodIsClosed,
  periodSeries,
  previousPeriod,
  trailingPeriods,
} from "../src/domain/period.js";

describe("calendar-day arithmetic", () => {
  it("rejects dates that only look valid", () => {
    assert.equal(isDateOnly("2026-02-28"), true);
    assert.equal(isDateOnly("2026-02-30"), false, "February never has 30 days");
    assert.equal(isDateOnly("2026-13-01"), false);
    assert.equal(isDateOnly("2026-2-1"), false, "must be zero-padded");
    assert.throws(() => dateOnly("2026-02-30", "expiresOn"), /expiresOn/);
  });

  it("keeps leap years straight", () => {
    assert.equal(isDateOnly("2028-02-29"), true);
    assert.equal(isDateOnly("2026-02-29"), false);
    assert.equal(addDays(dateOnly("2028-02-28"), 1), "2028-02-29");
  });

  it("clamps month arithmetic to the end of a short month", () => {
    // A certificate issued on the 31st renews to the 28th, not the 3rd.
    assert.equal(addMonths(dateOnly("2026-01-31"), 1), "2026-02-28");
    assert.equal(addMonths(dateOnly("2026-01-31"), 13), "2027-02-28");
    assert.equal(addMonths(dateOnly("2028-01-31"), 1), "2028-02-29");
    assert.equal(addMonths(dateOnly("2026-03-31"), -1), "2026-02-28");
  });

  it("counts whole days in both directions", () => {
    assert.equal(daysBetween(dateOnly("2026-01-01"), dateOnly("2026-01-31")), 30);
    assert.equal(daysBetween(dateOnly("2026-01-31"), dateOnly("2026-01-01")), -30);
    // Spanning a daylight-saving boundary must still be whole days.
    assert.equal(daysBetween(dateOnly("2026-03-28"), dateOnly("2026-03-30")), 2);
  });

  it("orders and bounds dates", () => {
    assert.equal(maxDate(dateOnly("2026-05-01"), dateOnly("2026-04-01")), "2026-05-01");
    assert.equal(minDate(dateOnly("2026-05-01"), dateOnly("2026-04-01")), "2026-04-01");
  });

  it("treats an open-ended window as running forever", () => {
    const open = { from: dateOnly("2026-01-01") };
    assert.equal(windowContains(open, dateOnly("2099-12-31")), true);
    assert.equal(windowContains(open, dateOnly("2025-12-31")), false);

    const closed = { from: dateOnly("2026-01-01"), to: dateOnly("2026-06-30") };
    assert.equal(windowContains(closed, dateOnly("2026-06-30")), true, "end date is inclusive");
    assert.equal(windowContains(closed, dateOnly("2026-07-01")), false);
  });

  it("detects overlapping price validity windows", () => {
    const first = { from: dateOnly("2026-01-01"), to: dateOnly("2026-06-30") };
    const abutting = { from: dateOnly("2026-07-01"), to: dateOnly("2026-12-31") };
    const overlapping = { from: dateOnly("2026-06-30") };
    assert.equal(windowsOverlap(first, abutting), false, "back-to-back windows do not overlap");
    assert.equal(windowsOverlap(first, overlapping), true, "a single shared day is an overlap");
  });

  it("rejects a window that ends before it starts", () => {
    assert.throws(
      () => assertWindow({ from: dateOnly("2026-06-01"), to: dateOnly("2026-05-01") }, "effectiveWindow"),
      /effectiveWindow/,
    );
  });
});

describe("performance periods", () => {
  it("parses the three period shapes", () => {
    assert.equal(parsePeriod("2026-03").kind, "month");
    assert.equal(parsePeriod("2026-Q1").kind, "quarter");
    assert.equal(parsePeriod("2026").kind, "year");
    assert.throws(() => parsePeriod("Q1-2026"), /unrecognised period code/);
  });

  it("derives the bounds of each period", () => {
    const february = parsePeriod("2026-02");
    assert.equal(february.start, "2026-02-01");
    assert.equal(february.end, "2026-02-28");

    const q1 = parsePeriod("2026-Q1");
    assert.equal(q1.start, "2026-01-01");
    assert.equal(q1.end, "2026-03-31");

    const year = parsePeriod("2026");
    assert.equal(year.start, "2026-01-01");
    assert.equal(year.end, "2026-12-31");
  });

  it("locates the period containing a date", () => {
    assert.equal(periodContaining(dateOnly("2026-08-17"), "quarter").code, "2026-Q3");
    assert.equal(periodContaining(dateOnly("2026-08-17"), "month").code, "2026-08");
    assert.equal(periodContaining(dateOnly("2026-08-17"), "year").code, "2026");
  });

  it("walks across year boundaries", () => {
    assert.equal(nextPeriod(parsePeriod("2026-12")).code, "2027-01");
    assert.equal(previousPeriod(parsePeriod("2026-Q1")).code, "2025-Q4");
    assert.equal(nextPeriod(parsePeriod("2026")).code, "2027");
  });

  it("sorts lexically within a kind, which is why codes are padded", () => {
    const codes = ["2026-10", "2026-02", "2026-01"].sort();
    assert.deepEqual(codes, ["2026-01", "2026-02", "2026-10"]);
    assert.ok(comparePeriods(parsePeriod("2026-Q2"), parsePeriod("2026-Q1")) > 0);
    assert.throws(() => comparePeriods(parsePeriod("2026-Q1"), parsePeriod("2026-01")), /cannot compare/);
  });

  it("builds trailing series for a trend", () => {
    const trailing = trailingPeriods(parsePeriod("2026-Q2"), 4).map((period) => period.code);
    assert.deepEqual(trailing, ["2025-Q3", "2025-Q4", "2026-Q1", "2026-Q2"]);

    const series = periodSeries(parsePeriod("2026-01"), parsePeriod("2026-04")).map((period) => period.code);
    assert.deepEqual(series, ["2026-01", "2026-02", "2026-03", "2026-04"]);
    assert.throws(() => periodSeries(parsePeriod("2026-04"), parsePeriod("2026-01")), /is after/);
  });

  it("knows when a period has finished", () => {
    const q1 = makePeriod("quarter", 2026, 1);
    assert.equal(periodIsClosed(q1, dateOnly("2026-03-31")), false, "still the last day of the quarter");
    assert.equal(periodIsClosed(q1, dateOnly("2026-04-01")), true);
  });

  it("rejects out-of-range period indexes", () => {
    assert.throws(() => makePeriod("month", 2026, 13), /month must be 1-12/);
    assert.throws(() => makePeriod("quarter", 2026, 5), /quarter must be 1-4/);
  });
});

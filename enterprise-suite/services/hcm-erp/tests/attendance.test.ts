import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { timeOfDay } from "../src/domain/common.js";
import { HcmEvents } from "../src/domain/events.js";
import { assertDomainError, buildSeededModule, d } from "./helpers.js";

const t = timeOfDay;

describe("attendance periods", () => {
  it("opens one period per employee per month", () => {
    const { module, tenant, seed } = buildSeededModule();
    module.attendanceService.openPeriod(tenant, seed.staffEngineer.id, 2026, 3);
    assertDomainError(
      () => module.attendanceService.openPeriod(tenant, seed.staffEngineer.id, 2026, 3),
      "CONFLICT",
    );
    assertDomainError(
      () => module.attendanceService.openPeriod(tenant, seed.staffEngineer.id, 2026, 13),
      "INVALID_MONTH",
    );
  });

  it("validates entries: dates, times, breaks, overlaps, daily caps, markers", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.attendanceService;
    const period = svc.openPeriod(tenant, seed.staffEngineer.id, 2026, 3);

    const entry = svc.addEntry(tenant, period.id, {
      date: d("2026-03-02"),
      kind: "work",
      startTime: t("09:00"),
      endTime: t("17:30"),
      breakMinutes: 30,
    });
    assert.equal(entry.hours, 8);

    // outside the period month
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-04-01"), kind: "work", startTime: t("09:00"), endTime: t("17:00") }),
      "ENTRY_OUTSIDE_PERIOD",
    );
    // timed kinds need times
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "remote" }),
      "ENTRY_TIMES_REQUIRED",
    );
    // end before start
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "work", startTime: t("17:00"), endTime: t("09:00") }),
      "INVALID_ENTRY_TIMES",
    );
    // break longer than the interval
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "work", startTime: t("09:00"), endTime: t("10:00"), breakMinutes: 90 }),
      "INVALID_BREAK",
    );
    // overlapping same-day interval
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-02"), kind: "work", startTime: t("17:00"), endTime: t("18:00") }),
      "ENTRY_OVERLAP",
    );
    // adjacent interval is fine (17:30 boundary)
    svc.addEntry(tenant, period.id, { date: d("2026-03-02"), kind: "work", startTime: t("17:30"), endTime: t("19:30") });
    // >16h in a single entry
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-05"), kind: "work", startTime: t("00:00"), endTime: t("16:30") }),
      "EXCESSIVE_HOURS",
    );
    // markers cannot coexist with timed entries on the same day
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-02"), kind: "sick" }),
      "MARKER_CONFLICT",
    );
    svc.addEntry(tenant, period.id, { date: d("2026-03-04"), kind: "sick" });
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-04"), kind: "work", startTime: t("09:00"), endTime: t("17:00") }),
      "MARKER_CONFLICT",
    );
    // markers cannot carry times
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-06"), kind: "holiday", startTime: t("09:00"), endTime: t("17:00") }),
      "MARKER_WITH_TIMES",
    );
  });

  it("computes totals with per-day overtime above 8h", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.attendanceService;
    const period = svc.openPeriod(tenant, seed.staffEngineer.id, 2026, 3);

    svc.addEntry(tenant, period.id, { date: d("2026-03-02"), kind: "work", startTime: t("09:00"), endTime: t("17:30"), breakMinutes: 30 }); // 8h
    svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "work", startTime: t("09:00"), endTime: t("19:00"), breakMinutes: 60 }); // 9h → 1h OT
    svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "training", startTime: t("20:00"), endTime: t("21:00") }); // +1h → 2h OT total that day
    svc.addEntry(tenant, period.id, { date: d("2026-03-04"), kind: "sick" });

    const totals = svc.totals(tenant, period.id);
    assert.equal(totals.totalHours, 18);
    assert.equal(totals.overtimeHours, 2);
    assert.equal(totals.workedDays, 2);
    assert.equal(totals.absenceDays, 1);
  });

  it("enforces the submit → approve → lock workflow with reopen", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.attendanceService;
    const period = svc.openPeriod(tenant, seed.staffEngineer.id, 2026, 3);

    assertDomainError(() => svc.submit(tenant, period.id), "EMPTY_PERIOD");
    svc.addEntry(tenant, period.id, { date: d("2026-03-02"), kind: "work", startTime: t("09:00"), endTime: t("17:00") });

    assertDomainError(() => svc.approve(tenant, period.id, seed.cto.id), "INVALID_STATUS_TRANSITION");
    svc.submit(tenant, period.id);
    assert.equal(period.status, "submitted");

    // no edits while submitted
    assertDomainError(
      () => svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "sick" }),
      "PERIOD_NOT_OPEN",
    );

    // manager sends it back for corrections
    svc.reopen(tenant, period.id, "please add the 3rd");
    svc.addEntry(tenant, period.id, { date: d("2026-03-03"), kind: "sick" });
    svc.submit(tenant, period.id);

    // self-approval is forbidden
    assertDomainError(() => svc.approve(tenant, period.id, seed.staffEngineer.id), "SELF_APPROVAL");
    svc.approve(tenant, period.id, seed.cto.id);
    assert.equal(period.status, "approved");

    assertDomainError(() => svc.reopen(tenant, period.id, "too late"), "INVALID_STATUS_TRANSITION");
    svc.lock(tenant, period.id);
    assert.equal(period.status, "locked");

    const emitted = module.outbox.drain();
    const approvedEvent = emitted.find((e) => e.eventType === HcmEvents.AttendanceApproved);
    assert.ok(approvedEvent);
    assert.equal((approvedEvent.payload as { totalHours: number }).totalHours, 8);
    assert.ok(emitted.some((e) => e.eventType === HcmEvents.AttendanceLocked));
  });

  it("removes entries by id while open", () => {
    const { module, tenant, seed } = buildSeededModule();
    const svc = module.attendanceService;
    const period = svc.openPeriod(tenant, seed.staffEngineer.id, 2026, 3);
    const entry = svc.addEntry(tenant, period.id, {
      date: d("2026-03-02"),
      kind: "work",
      startTime: t("09:00"),
      endTime: t("17:00"),
    });
    svc.removeEntry(tenant, period.id, entry.entryId);
    assert.equal(period.entries.length, 0);
    assertDomainError(() => svc.removeEntry(tenant, period.id, entry.entryId), "ENTRY_NOT_FOUND");
  });
});

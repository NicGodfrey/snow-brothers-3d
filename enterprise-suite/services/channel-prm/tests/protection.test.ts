import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IsoDateTime, UserId } from "@enterprise-suite/shared-kernel";
import {
  addDays,
  daysBetween,
  describeWindow,
  elapsedDays,
  expiresWithin,
  extendWindow,
  hasLapsed,
  intersection,
  isProtectedAt,
  openWindow,
  overlapDays,
  remainingDays,
  totalGrantedDays,
  truncateWindow,
  withinGrace,
  type ExtensionPolicy,
} from "../src/domain/protection.js";
import { expectThrows } from "./helpers.js";

const START = "2026-01-01T00:00:00.000Z" as IsoDateTime;
const GRANTOR = "channel-manager" as UserId;

const policy: ExtensionPolicy = { maxExtensionDays: 45, maxExtensions: 2, renewalGraceDays: 10 };

describe("protection windows", () => {
  it("opens a half-open window and refuses nonsense grants", () => {
    const window = openWindow(START, 90);
    assert.equal(window.startsAt, START);
    assert.equal(window.endsAt, "2026-04-01T00:00:00.000Z");
    assert.equal(window.grantedDays, 90);

    // The window includes its start and excludes its end.
    assert.equal(isProtectedAt(window, START), true);
    assert.equal(isProtectedAt(window, "2026-03-31T23:59:59.000Z" as IsoDateTime), true);
    assert.equal(isProtectedAt(window, window.endsAt), false);
    assert.equal(hasLapsed(window, window.endsAt), true);

    expectThrows(() => openWindow(START, 0), "VALIDATION", "between 1 and 730");
    expectThrows(() => openWindow(START, 45.5), "VALIDATION", "between 1 and 730");
    expectThrows(() => openWindow("not-a-date" as IsoDateTime, 30), "VALIDATION");
  });

  it("counts remaining days up and elapsed days down, clamped at the edges", () => {
    const window = openWindow(START, 30);
    assert.equal(remainingDays(window, START), 30);
    // Rounded up: half a day left still shows as a day on the portal countdown.
    assert.equal(remainingDays(window, "2026-01-20T12:00:00.000Z" as IsoDateTime), 11);
    assert.equal(remainingDays(window, "2026-02-15T00:00:00.000Z" as IsoDateTime), 0);
    assert.equal(elapsedDays(window, "2026-01-10T18:00:00.000Z" as IsoDateTime), 9);
    assert.equal(elapsedDays(window, "2025-12-01T00:00:00.000Z" as IsoDateTime), 0);
    assert.equal(expiresWithin(window, "2026-01-25T00:00:00.000Z" as IsoDateTime, 7), true);
    assert.equal(expiresWithin(window, "2026-01-10T00:00:00.000Z" as IsoDateTime, 7), false);
    assert.equal(expiresWithin(window, "2026-03-01T00:00:00.000Z" as IsoDateTime, 7), false);
  });

  it("extends from the current end date so repeated grants cannot compound", () => {
    const window = openWindow(START, 60);
    const once = extendWindow(window, {
      days: 30,
      reason: "customer pushed the decision to next quarter",
      grantedBy: GRANTOR,
      grantedAt: "2026-01-15T00:00:00.000Z" as IsoDateTime,
      policy,
    });
    // 30 days added to the end (2026-03-02), not to the grant date.
    assert.equal(once.endsAt, "2026-04-01T00:00:00.000Z");
    assert.equal(once.startsAt, START);
    assert.equal(once.grantedDays, 60);
    assert.equal(totalGrantedDays(once), 90);
    assert.equal(once.extensions.length, 1);
    assert.equal(once.extensions[0]!.previousEndsAt, "2026-03-02T00:00:00.000Z");

    const twice = extendWindow(once, {
      days: 10,
      reason: "final signature pending",
      grantedBy: GRANTOR,
      grantedAt: "2026-03-20T00:00:00.000Z" as IsoDateTime,
      policy,
    });
    assert.equal(twice.endsAt, "2026-04-11T00:00:00.000Z");
    assert.equal(totalGrantedDays(twice), 100);
  });

  it("enforces the tier's extension caps", () => {
    const window = openWindow(START, 60);
    expectThrows(
      () => extendWindow(window, { days: 60, reason: "slip", grantedBy: GRANTOR, grantedAt: START, policy }),
      "POLICY_VIOLATION",
      "exceeds the tier cap of 45 days",
    );
    expectThrows(
      () => extendWindow(window, { days: 0, reason: "slip", grantedBy: GRANTOR, grantedAt: START, policy }),
      "VALIDATION",
      "positive integer",
    );
    expectThrows(
      () => extendWindow(window, { days: 10, reason: "  ", grantedBy: GRANTOR, grantedAt: START, policy }),
      "VALIDATION",
      "extension reason is required",
    );

    const single: ExtensionPolicy = { ...policy, maxExtensions: 1 };
    const extended = extendWindow(window, {
      days: 10,
      reason: "one allowed",
      grantedBy: GRANTOR,
      grantedAt: START,
      policy: single,
    });
    expectThrows(
      () =>
        extendWindow(extended, {
          days: 10,
          reason: "one too many",
          grantedBy: GRANTOR,
          grantedAt: START,
          policy: single,
        }),
      "POLICY_VIOLATION",
      "the tier allows 1",
    );
  });

  it("revives a lapsed window inside the grace period and restarts the clock at the grant", () => {
    const window = openWindow(START, 30); // ends 2026-01-31
    const insideGrace = "2026-02-05T00:00:00.000Z" as IsoDateTime;
    assert.equal(withinGrace(window, insideGrace, policy.renewalGraceDays), true);

    const revived = extendWindow(window, {
      days: 15,
      reason: "partner re-engaged the buyer",
      grantedBy: GRANTOR,
      grantedAt: insideGrace,
      policy,
    });
    // Days run from the grant, not from the lapsed end: no free catch-up days.
    assert.equal(revived.endsAt, "2026-02-20T00:00:00.000Z");
    assert.equal(isProtectedAt(revived, insideGrace), true);

    const tooLate = "2026-02-20T00:00:00.000Z" as IsoDateTime;
    assert.equal(withinGrace(window, tooLate, policy.renewalGraceDays), false);
    expectThrows(
      () =>
        extendWindow(window, {
          days: 15,
          reason: "far too late",
          grantedBy: GRANTOR,
          grantedAt: tooLate,
          policy,
        }),
      "POLICY_VIOLATION",
      "must be re-registered",
    );
  });

  it("truncates but never silently extends", () => {
    const window = openWindow(START, 90);
    const cut = truncateWindow(window, "2026-02-01T00:00:00.000Z" as IsoDateTime);
    assert.equal(cut.endsAt, "2026-02-01T00:00:00.000Z");
    assert.equal(cut.grantedDays, 90, "the original grant is preserved for audit");

    const attemptedExtension = truncateWindow(window, "2026-12-01T00:00:00.000Z" as IsoDateTime);
    assert.equal(attemptedExtension.endsAt, window.endsAt);

    const beforeStart = truncateWindow(window, "2025-01-01T00:00:00.000Z" as IsoDateTime);
    assert.equal(beforeStart.endsAt, window.startsAt, "clamped to the start, never inverted");
  });

  it("intersects intervals on the half-open convention", () => {
    const a = { startsAt: START, endsAt: "2026-03-01T00:00:00.000Z" as IsoDateTime };
    const b = { startsAt: "2026-02-01T00:00:00.000Z" as IsoDateTime, endsAt: "2026-04-01T00:00:00.000Z" as IsoDateTime };
    const shared = intersection(a, b);
    assert.equal(shared?.startsAt, "2026-02-01T00:00:00.000Z");
    assert.equal(shared?.endsAt, "2026-03-01T00:00:00.000Z");
    assert.equal(Math.round(overlapDays(a, b)), 28);

    const touching = { startsAt: "2026-03-01T00:00:00.000Z" as IsoDateTime, endsAt: "2026-04-01T00:00:00.000Z" as IsoDateTime };
    assert.equal(intersection(a, touching), undefined, "abutting windows do not overlap");
    assert.equal(overlapDays(a, touching), 0);
  });

  it("describes a window the way the partner portal renders it", () => {
    const window = extendWindow(openWindow(START, 30), {
      days: 15,
      reason: "extended once",
      grantedBy: GRANTOR,
      grantedAt: "2026-01-20T00:00:00.000Z" as IsoDateTime,
      policy,
    });
    const snapshot = describeWindow(window, "2026-02-01T00:00:00.000Z" as IsoDateTime);
    assert.deepEqual(snapshot, {
      startsAt: START,
      endsAt: "2026-02-15T00:00:00.000Z",
      grantedDays: 30,
      totalDays: 45,
      extensionCount: 1,
      active: true,
      remainingDays: 14,
      elapsedDays: 31,
    });
  });

  it("does date arithmetic in whole and fractional days", () => {
    assert.equal(addDays(START, 1), "2026-01-02T00:00:00.000Z");
    assert.equal(addDays(START, 0.5), "2026-01-01T12:00:00.000Z");
    assert.equal(daysBetween(START, "2026-01-11T00:00:00.000Z" as IsoDateTime), 10);
    assert.equal(daysBetween("2026-01-11T00:00:00.000Z" as IsoDateTime, START), -10);
  });
});

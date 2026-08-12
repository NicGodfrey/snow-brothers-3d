import type { IsoDateTime, UserId } from "@enterprise-suite/shared-kernel";
import { PolicyViolationError, ValidationError } from "./errors.js";

/**
 * Deal-protection windows.
 *
 * A protection window is the exclusivity a partner earns when a registration
 * is approved: for its duration nobody else can register the same customer for
 * the same product lines, and the partner's discount band applies. Everything
 * here is a pure function over an immutable value object so the same maths is
 * used by the aggregate, the conflict detector, the expiry sweep and the
 * analytics roll-ups.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ProtectionExtension {
  readonly days: number;
  readonly reason: string;
  readonly grantedBy: UserId;
  readonly grantedAt: IsoDateTime;
  readonly previousEndsAt: IsoDateTime;
}

export interface ProtectionWindow {
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  /** Days granted at approval, before any extension. */
  readonly grantedDays: number;
  readonly extensions: readonly ProtectionExtension[];
}

export interface ExtensionPolicy {
  readonly maxExtensionDays: number;
  readonly maxExtensions: number;
  /** Days after expiry during which an extension can still revive the window. */
  readonly renewalGraceDays: number;
}

export function addDays(at: IsoDateTime, days: number): IsoDateTime {
  const millis = Date.parse(at);
  if (Number.isNaN(millis)) throw ValidationError.single("at", `"${at}" is not an ISO date-time`);
  return new Date(millis + days * MS_PER_DAY).toISOString() as IsoDateTime;
}

export function daysBetween(from: IsoDateTime, to: IsoDateTime): number {
  return (Date.parse(to) - Date.parse(from)) / MS_PER_DAY;
}

export function assertIso(value: string, field: string): IsoDateTime {
  if (Number.isNaN(Date.parse(value))) {
    throw ValidationError.single(field, "must be an ISO date-time");
  }
  return value as IsoDateTime;
}

export function openWindow(startsAt: IsoDateTime, days: number): ProtectionWindow {
  if (!Number.isInteger(days) || days < 1 || days > 730) {
    throw ValidationError.single("protectionDays", "must be an integer between 1 and 730");
  }
  return {
    startsAt: assertIso(startsAt, "startsAt"),
    endsAt: addDays(startsAt, days),
    grantedDays: days,
    extensions: [],
  };
}

export function isProtectedAt(window: ProtectionWindow, at: IsoDateTime): boolean {
  const now = Date.parse(at);
  return now >= Date.parse(window.startsAt) && now < Date.parse(window.endsAt);
}

export function hasLapsed(window: ProtectionWindow, at: IsoDateTime): boolean {
  return Date.parse(at) >= Date.parse(window.endsAt);
}

/** Whole days left, rounded up; 0 once lapsed. Used by portal countdowns. */
export function remainingDays(window: ProtectionWindow, at: IsoDateTime): number {
  const remaining = daysBetween(at, window.endsAt);
  return remaining <= 0 ? 0 : Math.ceil(remaining);
}

export function elapsedDays(window: ProtectionWindow, at: IsoDateTime): number {
  const elapsed = daysBetween(window.startsAt, at);
  return elapsed <= 0 ? 0 : Math.floor(elapsed);
}

/** Total days of exclusivity granted so far, extensions included. */
export function totalGrantedDays(window: ProtectionWindow): number {
  return window.grantedDays + window.extensions.reduce((sum, e) => sum + e.days, 0);
}

export function expiresWithin(window: ProtectionWindow, at: IsoDateTime, days: number): boolean {
  return !hasLapsed(window, at) && remainingDays(window, at) <= days;
}

export function withinGrace(window: ProtectionWindow, at: IsoDateTime, graceDays: number): boolean {
  if (!hasLapsed(window, at)) return true;
  return daysBetween(window.endsAt, at) <= graceDays;
}

export interface Interval {
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
}

/** Half-open [start, end) intersection; undefined when the windows are disjoint. */
export function intersection(a: Interval, b: Interval): Interval | undefined {
  const start = Math.max(Date.parse(a.startsAt), Date.parse(b.startsAt));
  const end = Math.min(Date.parse(a.endsAt), Date.parse(b.endsAt));
  if (start >= end) return undefined;
  return {
    startsAt: new Date(start).toISOString() as IsoDateTime,
    endsAt: new Date(end).toISOString() as IsoDateTime,
  };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return intersection(a, b) !== undefined;
}

export function overlapDays(a: Interval, b: Interval): number {
  const shared = intersection(a, b);
  return shared ? daysBetween(shared.startsAt, shared.endsAt) : 0;
}

export interface ExtendInput {
  readonly days: number;
  readonly reason: string;
  readonly grantedBy: UserId;
  readonly grantedAt: IsoDateTime;
  readonly policy: ExtensionPolicy;
}

/**
 * Extends a window and returns the new value.
 *
 * Extension days always run from the current end date, not from "now", so
 * repeated extensions cannot silently compound into unbounded exclusivity. A
 * lapsed window can still be revived inside the tier's renewal grace, in which
 * case the clock restarts at the grant time — the partner does not get free
 * days for the period they let slip.
 */
export function extendWindow(window: ProtectionWindow, input: ExtendInput): ProtectionWindow {
  const { policy } = input;
  if (!Number.isInteger(input.days) || input.days < 1) {
    throw ValidationError.single("days", "must be a positive integer");
  }
  if (input.reason.trim().length === 0) {
    throw ValidationError.single("reason", "an extension reason is required");
  }
  if (window.extensions.length >= policy.maxExtensions) {
    throw new PolicyViolationError(
      `Protection already extended ${window.extensions.length} time(s); the tier allows ${policy.maxExtensions}`,
      "protection.maxExtensions",
      { granted: window.extensions.length, allowed: policy.maxExtensions },
    );
  }
  if (input.days > policy.maxExtensionDays) {
    throw new PolicyViolationError(
      `Extension of ${input.days} days exceeds the tier cap of ${policy.maxExtensionDays} days`,
      "protection.maxExtensionDays",
      { requested: input.days, allowed: policy.maxExtensionDays },
    );
  }
  const lapsed = hasLapsed(window, input.grantedAt);
  if (lapsed && !withinGrace(window, input.grantedAt, policy.renewalGraceDays)) {
    throw new PolicyViolationError(
      `Protection lapsed more than ${policy.renewalGraceDays} day(s) ago; the deal must be re-registered`,
      "protection.renewalGrace",
      { endsAt: window.endsAt, at: input.grantedAt },
    );
  }
  const base = lapsed ? input.grantedAt : window.endsAt;
  return {
    startsAt: window.startsAt,
    endsAt: addDays(base, input.days),
    grantedDays: window.grantedDays,
    extensions: [
      ...window.extensions,
      {
        days: input.days,
        reason: input.reason.trim(),
        grantedBy: input.grantedBy,
        grantedAt: input.grantedAt,
        previousEndsAt: window.endsAt,
      },
    ],
  };
}

/**
 * Cuts a window short, e.g. when a conflict is adjudicated against the holder.
 * Never extends: the new end is clamped to the existing one.
 */
export function truncateWindow(window: ProtectionWindow, endsAt: IsoDateTime): ProtectionWindow {
  const target = Math.min(Date.parse(assertIso(endsAt, "endsAt")), Date.parse(window.endsAt));
  const clamped = Math.max(target, Date.parse(window.startsAt));
  return { ...window, endsAt: new Date(clamped).toISOString() as IsoDateTime };
}

export interface ProtectionSnapshot {
  readonly startsAt: IsoDateTime;
  readonly endsAt: IsoDateTime;
  readonly grantedDays: number;
  readonly totalDays: number;
  readonly extensionCount: number;
  readonly active: boolean;
  readonly remainingDays: number;
  readonly elapsedDays: number;
}

/** Portal-facing view of a window at a point in time. */
export function describeWindow(window: ProtectionWindow, at: IsoDateTime): ProtectionSnapshot {
  return {
    startsAt: window.startsAt,
    endsAt: window.endsAt,
    grantedDays: window.grantedDays,
    totalDays: totalGrantedDays(window),
    extensionCount: window.extensions.length,
    active: isProtectedAt(window, at),
    remainingDays: remainingDays(window, at),
    elapsedDays: elapsedDays(window, at),
  };
}

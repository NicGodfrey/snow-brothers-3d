/**
 * ISO date-time arithmetic. Scheduling (backoff, leases, key expiry) is done
 * on branded `IsoDateTime` values rather than `Date` so aggregates stay
 * serialization-friendly and comparisons are explicit.
 */
import { brand, DomainError, type IsoDateTime } from "@enterprise-suite/shared-kernel";

export function isoOf(value: string | Date): IsoDateTime {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new DomainError(`Invalid date-time: ${String(value)}`, "VALIDATION");
  }
  return brand<string, "IsoDateTime">(date.toISOString());
}

export function epochMs(value: IsoDateTime): number {
  return new Date(value).getTime();
}

export function epochSeconds(value: IsoDateTime): number {
  return Math.floor(epochMs(value) / 1000);
}

export function addMs(value: IsoDateTime, ms: number): IsoDateTime {
  return isoOf(new Date(epochMs(value) + ms));
}

/** True when `a` is at or before `b`. */
export function atOrBefore(a: IsoDateTime, b: IsoDateTime): boolean {
  return epochMs(a) <= epochMs(b);
}

export function isAfter(a: IsoDateTime, b: IsoDateTime): boolean {
  return epochMs(a) > epochMs(b);
}

export function durationMs(from: IsoDateTime, to: IsoDateTime): number {
  return epochMs(to) - epochMs(from);
}

export function earliest(a: IsoDateTime, b: IsoDateTime): IsoDateTime {
  return epochMs(a) <= epochMs(b) ? a : b;
}

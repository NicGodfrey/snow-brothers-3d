import { DomainError } from "@enterprise-suite/shared-kernel";

/** Transport modes supported by the TMS. */
export type TransportMode = "parcel" | "ltl" | "ftl";

export const TRANSPORT_MODES: readonly TransportMode[] = ["parcel", "ltl", "ftl"];

export function isTransportMode(value: string): value is TransportMode {
  return (TRANSPORT_MODES as readonly string[]).includes(value);
}

/** Postal address used for shipment origins/destinations and load stops. */
export interface Address {
  readonly name: string;
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode: string;
  readonly country: string; // ISO 3166-1 alpha-2
}

export function validateAddress(address: Address, label = "address"): Address {
  if (!address || typeof address !== "object") {
    throw new DomainError(`${label} is required`, "VALIDATION");
  }
  const required: (keyof Address)[] = ["name", "line1", "city", "postalCode", "country"];
  for (const key of required) {
    const value = address[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new DomainError(`${label}.${String(key)} is required`, "VALIDATION");
    }
  }
  if (!/^[A-Za-z]{2}$/.test(address.country)) {
    throw new DomainError(
      `${label}.country must be an ISO 3166-1 alpha-2 code`,
      "VALIDATION",
    );
  }
  return {
    ...address,
    country: address.country.toUpperCase(),
    postalCode: address.postalCode.trim(),
  };
}

/** Package dimensions in whole centimeters. */
export interface Dimensions {
  readonly lengthCm: number;
  readonly widthCm: number;
  readonly heightCm: number;
}

export function validateDimensions(dims: Dimensions, label = "dimensions"): Dimensions {
  for (const key of ["lengthCm", "widthCm", "heightCm"] as const) {
    const value = dims?.[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new DomainError(`${label}.${key} must be a positive number`, "VALIDATION");
    }
  }
  return dims;
}

export function volumeCm3(dims: Dimensions): number {
  return dims.lengthCm * dims.widthCm * dims.heightCm;
}

/** Reference generator for human-facing document numbers (SHP-, LOAD-, DOCK-). */
export function documentReference(prefix: string): string {
  const time = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${time}${rand}`;
}

export function assertPositiveNumber(value: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DomainError(`${field} must be a positive number`, "VALIDATION");
  }
  return value;
}

export function assertNonNegativeInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(`${field} must be a non-negative integer`, "VALIDATION");
  }
  return value;
}

export function assertIsoDateTime(value: string, field: string): string {
  const parsed = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(parsed)) {
    throw new DomainError(`${field} must be an ISO-8601 date-time`, "VALIDATION");
  }
  return new Date(parsed).toISOString();
}

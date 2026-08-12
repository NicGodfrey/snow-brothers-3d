import type { Email } from "@enterprise-suite/shared-kernel";
import { ValidationError, type ValidationIssue } from "./errors.js";

/** Shared value objects used across supplier master, contracts and audits. */

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ()./-]{5,24}$/;

/** Uppercased, punctuation-limited business code (supplier code, site code). */
export function businessCode(value: string, field = "code"): string {
  const normalized = value.trim().toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw ValidationError.single(
      field,
      "must be 2-32 chars of A-Z, 0-9, dot, dash or underscore, starting alphanumeric",
    );
  }
  return normalized;
}

/** Lowercase slug used for taxonomy nodes and KPI codes. */
export function slug(value: string, field = "slug"): string {
  const normalized = value.trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(normalized)) {
    throw ValidationError.single(field, "must be 2-64 chars of a-z, 0-9 or dash");
  }
  return normalized;
}

export function emailAddress(value: string, field = "email"): Email {
  const normalized = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalized)) {
    throw ValidationError.single(field, "must be a valid email address");
  }
  return normalized as Email;
}

export function phoneNumber(value: string, field = "phone"): string {
  const normalized = value.trim();
  if (!PHONE_PATTERN.test(normalized)) {
    throw ValidationError.single(field, "must be a valid phone number");
  }
  return normalized;
}

export function countryCode(value: string, field = "countryCode"): string {
  const normalized = value.trim().toUpperCase();
  if (!COUNTRY_PATTERN.test(normalized)) {
    throw ValidationError.single(field, "must be an ISO 3166-1 alpha-2 country code");
  }
  return normalized;
}

export function currencyCodeOf(value: string, field = "currency"): string {
  const normalized = value.trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(normalized)) {
    throw ValidationError.single(field, "must be an ISO 4217 currency code");
  }
  return normalized;
}

export function nonEmpty(value: string, field: string, maxLength = 200): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw ValidationError.single(field, "must not be empty");
  if (trimmed.length > maxLength) {
    throw ValidationError.single(field, `must be at most ${maxLength} characters`);
  }
  return trimmed;
}

export function boundedInt(value: number, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw ValidationError.single(field, `must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function ratio(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw ValidationError.single(field, "must be a fraction between 0 and 1");
  }
  return value;
}

export interface Address {
  readonly line1: string;
  readonly line2?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly countryCode: string;
}

export function address(input: Address, field = "address"): Address {
  const issues: ValidationIssue[] = [];
  const line1 = input.line1?.trim() ?? "";
  const city = input.city?.trim() ?? "";
  if (line1.length === 0) issues.push({ field: `${field}.line1`, message: "must not be empty" });
  if (city.length === 0) issues.push({ field: `${field}.city`, message: "must not be empty" });
  if (!COUNTRY_PATTERN.test(input.countryCode?.trim().toUpperCase() ?? "")) {
    issues.push({ field: `${field}.countryCode`, message: "must be an ISO 3166-1 alpha-2 code" });
  }
  if (issues.length > 0) throw new ValidationError(`Invalid ${field}`, issues);
  return {
    line1,
    line2: input.line2?.trim() || undefined,
    city,
    region: input.region?.trim() || undefined,
    postalCode: input.postalCode?.trim() || undefined,
    countryCode: input.countryCode.trim().toUpperCase(),
  };
}

export function formatAddress(value: Address): string {
  return [value.line1, value.line2, value.city, value.region, value.postalCode, value.countryCode]
    .filter((part): part is string => Boolean(part))
    .join(", ");
}

/**
 * Payment terms as a code plus the net days they resolve to, with optional
 * early-payment discount ("2/10 net 30").
 */
export interface PaymentTerms {
  readonly code: string;
  readonly netDays: number;
  readonly discountPercent?: number;
  readonly discountDays?: number;
}

const STANDARD_TERMS: Readonly<Record<string, PaymentTerms>> = {
  IMMEDIATE: { code: "IMMEDIATE", netDays: 0 },
  NET15: { code: "NET15", netDays: 15 },
  NET30: { code: "NET30", netDays: 30 },
  NET45: { code: "NET45", netDays: 45 },
  NET60: { code: "NET60", netDays: 60 },
  NET90: { code: "NET90", netDays: 90 },
  "2_10_NET30": { code: "2_10_NET30", netDays: 30, discountPercent: 2, discountDays: 10 },
  "1_15_NET45": { code: "1_15_NET45", netDays: 45, discountPercent: 1, discountDays: 15 },
};

export const STANDARD_PAYMENT_TERM_CODES: readonly string[] = Object.keys(STANDARD_TERMS);

export function paymentTerms(code: string, field = "paymentTerms"): PaymentTerms {
  const normalized = code.trim().toUpperCase();
  const found = STANDARD_TERMS[normalized];
  if (!found) {
    throw ValidationError.single(field, `unknown payment terms "${code}"`);
  }
  return found;
}

/** Incoterms 2020 — the subset a manufacturer's SRM realistically uses. */
export type Incoterm = "EXW" | "FCA" | "FAS" | "FOB" | "CFR" | "CIF" | "CPT" | "CIP" | "DAP" | "DPU" | "DDP";

export const INCOTERMS: readonly Incoterm[] = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
];

export function isIncoterm(value: string): value is Incoterm {
  return (INCOTERMS as readonly string[]).includes(value.toUpperCase());
}

export function incoterm(value: string, field = "incoterm"): Incoterm {
  const normalized = value.trim().toUpperCase();
  if (!isIncoterm(normalized)) {
    throw ValidationError.single(field, `must be one of [${INCOTERMS.join(", ")}]`);
  }
  return normalized;
}

/**
 * Diversity / socio-economic classifications tracked for spend reporting.
 * They are self-declared until a certification of the matching type is
 * verified, which is why they live next to the supplier rather than inside it.
 */
export type DiversityFlag =
  | "small_business"
  | "minority_owned"
  | "women_owned"
  | "veteran_owned"
  | "disability_owned"
  | "lgbtq_owned"
  | "social_enterprise"
  | "local";

export const DIVERSITY_FLAGS: readonly DiversityFlag[] = [
  "small_business",
  "minority_owned",
  "women_owned",
  "veteran_owned",
  "disability_owned",
  "lgbtq_owned",
  "social_enterprise",
  "local",
];

export function isDiversityFlag(value: string): value is DiversityFlag {
  return (DIVERSITY_FLAGS as readonly string[]).includes(value);
}

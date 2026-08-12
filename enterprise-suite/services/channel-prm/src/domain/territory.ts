import { ValidationError, type ValidationIssue } from "./errors.js";

/**
 * End-customer identity and territory matching.
 *
 * Deal protection only means something if two partners registering the same
 * company resolve to the same key, so identity resolution lives in one place
 * and is deliberately conservative: a verified web domain wins, otherwise a
 * normalized legal name scoped by country. Names alone across countries are
 * *not* the same customer (Acme GmbH in DE is a different buying centre from
 * Acme Inc in US).
 */

export interface EndCustomer {
  readonly name: string;
  /** Web domain, the strongest available identity signal. */
  readonly domain?: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
  readonly region?: string;
  readonly city?: string;
  readonly taxId?: string;
  /** Optional link to a sales-erp account once the customer exists there. */
  readonly accountRef?: string;
}

export type CustomerKey = string;

/** Suffixes stripped before comparing legal names. */
const LEGAL_SUFFIXES = [
  "incorporated",
  "corporation",
  "limited",
  "holdings",
  "company",
  "group",
  "gmbh",
  "sarl",
  "srl",
  "b.v.",
  "bv",
  "n.v.",
  "nv",
  "a/s",
  "ab",
  "oy",
  "plc",
  "ltd",
  "llc",
  "lp",
  "llp",
  "pty",
  "pte",
  "inc",
  "co",
  "sa",
  "ag",
  "kk",
];

/** Public mailbox providers are never a company identity. */
const FREEMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "protonmail.com",
  "proton.me",
  "aol.com",
  "gmx.de",
  "web.de",
  "qq.com",
  "163.com",
]);

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

/** Strips scheme, credentials, `www.` and path; returns undefined for freemail. */
export function normalizeDomain(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let value = raw.trim().toLowerCase();
  if (value.length === 0) return undefined;
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.replace(/^[^@/]*@/, "");
  value = value.split("/")[0] ?? value;
  value = value.split("?")[0] ?? value;
  value = value.split(":")[0] ?? value;
  value = value.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return undefined;
  if (FREEMAIL_DOMAINS.has(value)) return undefined;
  return value;
}

/** Legal name reduced to its distinctive part: "Acme Holdings GmbH" -> "acme". */
export function normalizeCompanyName(name: string): string {
  const slug = slugify(name);
  const parts = slug.split("-").filter(Boolean);
  while (parts.length > 1 && LEGAL_SUFFIXES.includes(parts[parts.length - 1]!)) {
    parts.pop();
  }
  return parts.join("-");
}

export function normalizeCountry(country: string): string {
  const value = country.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) {
    throw ValidationError.single("endCustomer.country", "must be an ISO 3166-1 alpha-2 code");
  }
  return value;
}

/**
 * Stable identity for protection and conflict checks.
 *
 * `domain:acme.com` when a real domain is known — it crosses borders, because
 * a domain-level match means the same corporate entity. Otherwise
 * `name:acme|DE`, deliberately country-scoped.
 */
export function customerKey(customer: EndCustomer): CustomerKey {
  const domain = normalizeDomain(customer.domain);
  if (domain) return `domain:${domain}`;
  const name = normalizeCompanyName(customer.name);
  return `name:${name}|${normalizeCountry(customer.country)}`;
}

export function validateEndCustomer(customer: EndCustomer): EndCustomer {
  const issues: ValidationIssue[] = [];
  const name = customer.name?.trim() ?? "";
  if (name.length < 2) {
    issues.push({ field: "endCustomer.name", message: "must be at least 2 characters" });
  }
  if (!customer.country || !/^[A-Za-z]{2}$/.test(customer.country.trim())) {
    issues.push({ field: "endCustomer.country", message: "must be an ISO 3166-1 alpha-2 code" });
  }
  if (customer.domain !== undefined && customer.domain.trim().length > 0 && !normalizeDomain(customer.domain)) {
    issues.push({
      field: "endCustomer.domain",
      message: "must be a routable company domain (public mailbox providers are rejected)",
    });
  }
  if (normalizeCompanyName(name).length === 0) {
    issues.push({ field: "endCustomer.name", message: "must contain more than a legal-form suffix" });
  }
  if (issues.length > 0) throw ValidationError.fromIssues("Invalid end customer", issues);
  return {
    name,
    domain: normalizeDomain(customer.domain),
    country: normalizeCountry(customer.country),
    region: customer.region?.trim() || undefined,
    city: customer.city?.trim() || undefined,
    taxId: customer.taxId?.trim() || undefined,
    accountRef: customer.accountRef?.trim() || undefined,
  };
}

/**
 * Sales regions and their member countries. A partner authorized for "EMEA"
 * covers every country listed here; the map is intentionally partial and
 * extended per tenant in a real deployment.
 */
export const REGION_COUNTRIES: Readonly<Record<string, readonly string[]>> = {
  NA: ["US", "CA", "MX"],
  LATAM: ["BR", "AR", "CL", "CO", "PE", "UY"],
  EMEA: [
    "GB", "IE", "FR", "DE", "NL", "BE", "LU", "ES", "PT", "IT", "CH", "AT",
    "SE", "NO", "DK", "FI", "PL", "CZ", "SK", "HU", "RO", "GR", "TR",
    "AE", "SA", "IL", "ZA", "EG", "KE", "NG",
  ],
  APAC: ["AU", "NZ", "JP", "KR", "SG", "MY", "TH", "ID", "PH", "VN", "IN", "HK", "TW"],
};

export function regionOf(country: string): string | undefined {
  const upper = country.trim().toUpperCase();
  for (const [region, countries] of Object.entries(REGION_COUNTRIES)) {
    if (countries.includes(upper)) return region;
  }
  return undefined;
}

/**
 * Territory grant matching. A grant is `*` (global), a region code, or a
 * country code; country grants beat nothing, region grants imply their
 * countries.
 */
export function territoryCovers(grants: readonly string[], country: string): boolean {
  const upper = country.trim().toUpperCase();
  const region = regionOf(upper);
  return grants.some((grant) => {
    const value = grant.trim().toUpperCase();
    if (value === "*" || value === "GLOBAL") return true;
    if (value === upper) return true;
    if (region && value === region) return true;
    return false;
  });
}

export function normalizeTerritory(grant: string): string {
  const value = grant.trim().toUpperCase();
  if (value === "*" || value === "GLOBAL") return "*";
  if (REGION_COUNTRIES[value]) return value;
  if (/^[A-Z]{2}$/.test(value)) return value;
  throw ValidationError.single(
    "territories",
    `"${grant}" is neither "*", a known region (${Object.keys(REGION_COUNTRIES).join(", ")}) nor an ISO country code`,
  );
}

export function normalizeProductLine(line: string): string {
  const value = slugify(line);
  if (value.length === 0) throw ValidationError.single("productLines", "must be a non-empty identifier");
  return value;
}

export function normalizeProductLines(lines: readonly string[]): string[] {
  if (lines.length === 0) throw ValidationError.single("productLines", "at least one product line is required");
  const normalized = [...new Set(lines.map(normalizeProductLine))];
  return normalized.sort();
}

/** Product lines present in both sets; the basis for "do these deals collide". */
export function productLineOverlap(a: readonly string[], b: readonly string[]): string[] {
  const other = new Set(b);
  return [...new Set(a.filter((line) => other.has(line)))].sort();
}

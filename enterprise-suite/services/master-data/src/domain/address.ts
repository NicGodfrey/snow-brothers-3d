import { AddressValidationError, type ValidationIssue } from "./errors.js";
import {
  findCountry,
  findSubdivision,
  requireCountry,
  type Country,
  type CountryCode,
} from "./country.js";

/**
 * Postal addresses.
 *
 * An address is a value object: it is normalized on the way in (whitespace,
 * casing, postal regrouping, subdivision name -> code) and validated against
 * the country's rules. Normalization is deliberately separate from validation
 * so an import pipeline can normalize a batch, then report which rows failed
 * instead of dying on the first bad row.
 */

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface PostalAddress {
  readonly organization?: string;
  readonly attention?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly line3?: string;
  readonly city: string;
  /** Subdivision code (state/province) where the country uses one. */
  readonly region?: string;
  readonly postalCode?: string;
  readonly countryCode: CountryCode;
  readonly coordinates?: GeoPoint;
}

export interface AddressInput {
  readonly organization?: string;
  readonly attention?: string;
  readonly line1: string;
  readonly line2?: string;
  readonly line3?: string;
  readonly city: string;
  readonly region?: string;
  readonly postalCode?: string;
  readonly countryCode: string;
  readonly coordinates?: GeoPoint;
}

function tidy(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Regroups a postal code into its country's display form (K1A0B1 ->
 * "K1A 0B1", 021101234 -> "02110-1234"). Codes whose compacted length does
 * not match the country's layout are left as typed: a half-entered code
 * should surface in validation, not be silently reshaped.
 */
export function formatPostalCode(country: Country, raw: string): string {
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, " ");
  const layout = country.postalLayout;
  if (!layout) return cleaned;

  const compactPrefix = layout.prefix?.replace(/[\s-]/g, "") ?? "";
  let compact = cleaned.replace(/[\s-]/g, "");
  if (compactPrefix.length > 0 && compact.startsWith(compactPrefix)) {
    compact = compact.slice(compactPrefix.length);
  }
  if (!layout.lengths.includes(compact.length)) return cleaned;

  let body = compact;
  if (layout.tail !== undefined) {
    body = `${compact.slice(0, compact.length - layout.tail)}${layout.separator}${compact.slice(-layout.tail)}`;
  } else if (layout.groups && layout.groups.length > 0) {
    const chunks: string[] = [];
    let index = 0;
    for (const size of layout.groups) {
      chunks.push(compact.slice(index, index + size));
      index += size;
    }
    if (index < compact.length) chunks.push(compact.slice(index));
    body = chunks.filter((chunk) => chunk.length > 0).join(layout.separator);
  }
  return `${layout.prefix ?? ""}${body}`;
}

/**
 * Canonicalizes an address without judging it. Unknown countries are passed
 * through uppercased so `validateAddress` can report them as an issue rather
 * than throwing here.
 */
export function normalizeAddress(input: AddressInput): PostalAddress {
  const rawCountry = input.countryCode.trim().toUpperCase();
  const country = findCountry(rawCountry);
  const region = tidy(input.region);
  const subdivision = country && region ? findSubdivision(String(country.alpha2), region) : undefined;

  return {
    organization: tidy(input.organization),
    attention: tidy(input.attention),
    line1: tidy(input.line1) ?? "",
    line2: tidy(input.line2),
    line3: tidy(input.line3),
    city: tidy(input.city) ?? "",
    region: subdivision ? subdivision.code : region?.toUpperCase(),
    postalCode:
      input.postalCode !== undefined && tidy(input.postalCode) !== undefined
        ? country
          ? formatPostalCode(country, input.postalCode)
          : tidy(input.postalCode)
        : undefined,
    countryCode: (country?.alpha2 ?? rawCountry) as CountryCode,
    coordinates: input.coordinates,
  };
}

export function validateAddress(address: PostalAddress): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const country = findCountry(String(address.countryCode));

  if (!country) {
    issues.push({ field: "countryCode", message: `unknown country "${address.countryCode}"` });
  }
  if (address.line1.trim().length === 0) {
    issues.push({ field: "line1", message: "street address is required" });
  }
  if (address.city.trim().length === 0) {
    issues.push({ field: "city", message: "city is required" });
  }

  if (country) {
    if (country.regionRequired && !address.region) {
      issues.push({ field: "region", message: `${country.name} addresses require a state/province` });
    }
    if (address.region && country.subdivisions && !findSubdivision(String(country.alpha2), address.region)) {
      issues.push({
        field: "region",
        message: `"${address.region}" is not a subdivision of ${country.name}`,
      });
    }
    if (country.postalRequired && !address.postalCode) {
      issues.push({
        field: "postalCode",
        message: `${country.name} addresses require a postal code${
          country.postalExample ? ` (e.g. ${country.postalExample})` : ""
        }`,
      });
    }
    if (address.postalCode && country.postalPattern && !country.postalPattern.test(address.postalCode)) {
      issues.push({
        field: "postalCode",
        message: `"${address.postalCode}" is not a valid ${country.name} postal code${
          country.postalExample ? ` (e.g. ${country.postalExample})` : ""
        }`,
      });
    }
  }

  const point = address.coordinates;
  if (point) {
    if (!Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90) {
      issues.push({ field: "coordinates.latitude", message: "must be between -90 and 90" });
    }
    if (!Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180) {
      issues.push({ field: "coordinates.longitude", message: "must be between -180 and 180" });
    }
  }
  return issues;
}

/** Normalizes then validates, throwing with every issue at once. */
export function buildAddress(input: AddressInput): PostalAddress {
  const address = normalizeAddress(input);
  const issues = validateAddress(address);
  if (issues.length > 0) {
    throw new AddressValidationError(
      `Invalid ${address.countryCode || "?"} address: ${issues.map((i) => i.field).join(", ")}`,
      issues,
    );
  }
  return address;
}

/** Renders the address as label lines using the country's layout. */
export function renderAddress(
  address: PostalAddress,
  options: { readonly includeCountry?: boolean } = {},
): readonly string[] {
  const country = findCountry(String(address.countryCode));
  const layout = country?.addressLayout ?? "postal-city";
  const lines: string[] = [];
  const push = (value: string | undefined): void => {
    const text = value?.trim().replace(/\s+/g, " ");
    if (text) lines.push(text);
  };

  push(address.organization);
  push(address.attention);

  if (layout === "postal-region-city") {
    push(address.postalCode);
    push([address.region, address.city].filter(Boolean).join(" "));
    push(address.line1);
    push(address.line2);
    push(address.line3);
  } else {
    push(address.line1);
    push(address.line2);
    push(address.line3);
    if (layout === "city-region-postal") {
      push([address.city, address.region, address.postalCode].filter(Boolean).join(" "));
    } else if (layout === "city-then-postal") {
      push(address.city);
      push(address.region);
      push(address.postalCode);
    } else {
      push([address.postalCode, address.city].filter(Boolean).join(" "));
      push(address.region);
    }
  }

  if (options.includeCountry !== false) push(country?.name ?? String(address.countryCode));
  return lines;
}

export function formatAddress(
  address: PostalAddress,
  options: { readonly includeCountry?: boolean } = {},
): string {
  return renderAddress(address, options).join("\n");
}

/** Common thoroughfare and unit abbreviations, folded for comparison only. */
const STREET_ABBREVIATIONS: Readonly<Record<string, string>> = {
  street: "st",
  str: "st",
  strasse: "str",
  strase: "str",
  avenue: "ave",
  av: "ave",
  boulevard: "blvd",
  road: "rd",
  drive: "dr",
  lane: "ln",
  court: "ct",
  place: "pl",
  square: "sq",
  parkway: "pkwy",
  highway: "hwy",
  suite: "ste",
  apartment: "apt",
  building: "bldg",
  floor: "fl",
  north: "n",
  south: "s",
  east: "e",
  west: "w",
  northeast: "ne",
  northwest: "nw",
  southeast: "se",
  southwest: "sw",
};

/**
 * Comparison key for duplicate detection: casing, punctuation, diacritics and
 * the usual street-word abbreviations are folded away so "1 Elm Street, Apt 4"
 * and "1 elm st apt. 4" collapse to the same string.
 */
export function addressFingerprint(address: PostalAddress): string {
  const words = [address.line1, address.line2, address.line3, address.city]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((word) => STREET_ABBREVIATIONS[word] ?? word);

  const postal = (address.postalCode ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return [String(address.countryCode), address.region ?? "", postal, words.join(" ")].join("|");
}

export function sameAddress(a: PostalAddress, b: PostalAddress): boolean {
  return addressFingerprint(a) === addressFingerprint(b);
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle distance in kilometres, used for nearest-site lookups. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Currency the country transacts in, used to default a customer's billing currency. */
export function defaultCurrencyFor(countryCodeValue: string): string {
  return requireCountry(countryCodeValue).currency;
}

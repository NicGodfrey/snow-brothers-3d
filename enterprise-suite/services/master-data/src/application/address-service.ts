import {
  buildAddress,
  formatAddress,
  haversineKm,
  normalizeAddress,
  renderAddress,
  validateAddress,
  type AddressInput,
  type GeoPoint,
  type PostalAddress,
} from "../domain/address.js";
import {
  COUNTRIES,
  findCountry,
  requireCountry,
  subdivisionsOf,
  type Country,
  type CountrySubdivision,
} from "../domain/country.js";
import type { ValidationIssue } from "../domain/errors.js";

export interface AddressCheckResult {
  readonly valid: boolean;
  readonly normalized: PostalAddress;
  readonly issues: readonly ValidationIssue[];
  readonly formatted: readonly string[];
}

export interface CountrySummary {
  readonly alpha2: string;
  readonly alpha3: string;
  readonly numeric: string;
  readonly name: string;
  readonly currency: string;
  readonly callingCode: string;
  readonly euMember: boolean;
  readonly postalExample?: string;
  readonly postalRequired: boolean;
  readonly regionRequired: boolean;
  readonly subdivisionCount: number;
}

function summarize(country: Country): CountrySummary {
  return {
    alpha2: String(country.alpha2),
    alpha3: country.alpha3,
    numeric: country.numeric,
    name: country.name,
    currency: country.currency,
    callingCode: country.callingCode,
    euMember: country.euMember,
    postalExample: country.postalExample,
    postalRequired: country.postalRequired,
    regionRequired: country.regionRequired,
    subdivisionCount: country.subdivisions?.length ?? 0,
  };
}

/**
 * Address and geography queries.
 *
 * Stateless: country rules are reference data, so nothing here touches a
 * repository. Import pipelines call `check` to normalize and grade a batch
 * without throwing, and interactive callers use `require` when they want an
 * error on invalid input.
 */
export class AddressService {
  listCountries(options: { readonly euOnly?: boolean; readonly search?: string } = {}): readonly CountrySummary[] {
    const search = options.search?.trim().toLowerCase();
    return COUNTRIES.filter((country) => (options.euOnly ? country.euMember : true))
      .filter((country) =>
        search
          ? country.name.toLowerCase().includes(search) ||
            String(country.alpha2).toLowerCase() === search ||
            country.alpha3.toLowerCase() === search
          : true,
      )
      .map(summarize)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getCountry(code: string): CountrySummary {
    return summarize(requireCountry(code));
  }

  listSubdivisions(code: string): readonly CountrySubdivision[] {
    requireCountry(code);
    return subdivisionsOf(code);
  }

  /** Normalizes and grades an address without throwing. */
  check(input: AddressInput): AddressCheckResult {
    const normalized = normalizeAddress(input);
    const issues = validateAddress(normalized);
    return {
      valid: issues.length === 0,
      normalized,
      issues,
      formatted: renderAddress(normalized),
    };
  }

  /** Normalizes and validates, throwing an AddressValidationError on failure. */
  require(input: AddressInput): PostalAddress {
    return buildAddress(input);
  }

  format(address: PostalAddress, options: { readonly includeCountry?: boolean } = {}): string {
    return formatAddress(address, options);
  }

  /** Country the address belongs to, when it is one this service knows. */
  countryOf(address: PostalAddress): CountrySummary | undefined {
    const country = findCountry(String(address.countryCode));
    return country ? summarize(country) : undefined;
  }

  distanceKm(a: GeoPoint, b: GeoPoint): number {
    return Math.round(haversineKm(a, b) * 1000) / 1000;
  }
}

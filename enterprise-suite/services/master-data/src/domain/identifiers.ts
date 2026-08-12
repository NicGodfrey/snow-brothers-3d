import { ValidationError } from "./errors.js";
import { findCountry, vatPrefixFor } from "./country.js";

/**
 * Party identifiers: VAT/tax registrations, GS1 location numbers, D-U-N-S,
 * LEI, IBAN and BIC.
 *
 * Every validator returns a structured verdict instead of a boolean so an
 * import can distinguish "wrong shape" from "shape is right but the check
 * digit fails" — the two need very different remediation. Country schemes
 * without a published check algorithm are validated on format alone and say
 * so via `checkedDigits: false`.
 */

export type IdentifierScheme =
  | "vat"
  | "tax"
  | "duns"
  | "gln"
  | "lei"
  | "iban"
  | "bic"
  | "internal";

export const IDENTIFIER_SCHEMES: readonly IdentifierScheme[] = [
  "vat",
  "tax",
  "duns",
  "gln",
  "lei",
  "iban",
  "bic",
  "internal",
];

export interface IdentifierVerdict {
  readonly valid: boolean;
  /** Canonical form (uppercased, punctuation stripped, country prefix applied). */
  readonly normalized: string;
  /** False when only the format could be checked. */
  readonly checkedDigits: boolean;
  readonly reason?: string;
}

function verdict(
  valid: boolean,
  normalized: string,
  checkedDigits: boolean,
  reason?: string,
): IdentifierVerdict {
  return { valid, normalized, checkedDigits, reason };
}

const compact = (value: string): string => value.toUpperCase().replace(/[\s.\-/]/g, "");

const digits = (value: string): number[] => [...value].map((c) => Number(c));

// --- national VAT check algorithms -------------------------------------------

/** German USt-IdNr: iterative mod 11/10 over the first eight digits. */
function checkDe(body: string): boolean {
  if (!/^\d{9}$/.test(body)) return false;
  let product = 10;
  for (const digit of digits(body.slice(0, 8))) {
    const sum = (digit + product) % 10 || 10;
    product = (2 * sum) % 11;
  }
  return (11 - product) % 10 === Number(body[8]);
}

/** Italian partita IVA: Luhn over ten digits. */
function checkIt(body: string): boolean {
  if (!/^\d{11}$/.test(body)) return false;
  let total = 0;
  digits(body.slice(0, 10)).forEach((digit, index) => {
    if (index % 2 === 0) {
      total += digit;
    } else {
      const doubled = digit * 2;
      total += doubled > 9 ? doubled - 9 : doubled;
    }
  });
  return (10 - (total % 10)) % 10 === Number(body[10]);
}

/** UK VAT: weighted mod 97, accepting both the classic and the "9755" series. */
function checkGb(body: string): boolean {
  if (/^(GD\d{3}|HA\d{3})$/.test(body)) return true; // government / health authority
  if (!/^\d{9}(\d{3})?$/.test(body)) return false;
  const core = body.slice(0, 9);
  const weights = [8, 7, 6, 5, 4, 3, 2];
  const weighted = digits(core.slice(0, 7)).reduce((sum, d, i) => sum + d * weights[i]!, 0);
  const checkDigits = Number(core.slice(7, 9));
  return (weighted + checkDigits) % 97 === 0 || (weighted + checkDigits + 55) % 97 === 0;
}

/** Dutch BTW-nummer: mod 11 over nine digits, followed by B and a suffix. */
function checkNl(body: string): boolean {
  if (!/^\d{9}B\d{2}$/.test(body)) return false;
  const weighted = digits(body.slice(0, 8)).reduce((sum, d, i) => sum + d * (9 - i), 0);
  const remainder = weighted % 11;
  return remainder < 10 && remainder === Number(body[8]);
}

/** French TVA: two-character key derived from the SIREN, when numeric. */
function checkFr(body: string): boolean {
  if (!/^[0-9A-Z]{2}\d{9}$/.test(body)) return false;
  const key = body.slice(0, 2);
  const siren = Number(body.slice(2));
  if (!/^\d{2}$/.test(key)) return true; // alphanumeric keys use an unpublished scheme
  return Number(key) === (12 + 3 * (siren % 97)) % 97;
}

/** Belgian BTW: 97 minus the first eight digits mod 97. */
function checkBe(body: string): boolean {
  if (!/^[01]\d{9}$/.test(body)) return false;
  return 97 - (Number(body.slice(0, 8)) % 97) === Number(body.slice(8));
}

/** Polish NIP: weighted mod 11; a remainder of 10 makes the number invalid. */
function checkPl(body: string): boolean {
  if (!/^\d{10}$/.test(body)) return false;
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const remainder = digits(body.slice(0, 9)).reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11;
  return remainder !== 10 && remainder === Number(body[9]);
}

/** Danish CVR: weighted mod 11 that must land exactly on zero. */
function checkDk(body: string): boolean {
  if (!/^\d{8}$/.test(body)) return false;
  const weights = [2, 7, 6, 5, 4, 3, 2, 1];
  return digits(body).reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11 === 0;
}

/** Finnish ALV: weighted mod 11; remainder 1 has no valid check digit. */
function checkFi(body: string): boolean {
  if (!/^\d{8}$/.test(body)) return false;
  const weights = [7, 9, 10, 5, 8, 4, 2];
  const remainder = digits(body.slice(0, 7)).reduce((sum, d, i) => sum + d * weights[i]!, 0) % 11;
  if (remainder === 1) return false;
  const check = remainder === 0 ? 0 : 11 - remainder;
  return check === Number(body[7]);
}

/** Swedish momsregistreringsnummer: Luhn over the ten-digit organisation number. */
function checkSe(body: string): boolean {
  if (!/^\d{10}01$/.test(body)) return false;
  return luhn(body.slice(0, 10));
}

function luhn(value: string): boolean {
  let total = 0;
  const reversed = [...value].reverse();
  reversed.forEach((char, index) => {
    let digit = Number(char);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    total += digit;
  });
  return total % 10 === 0;
}

interface VatScheme {
  readonly pattern: RegExp;
  readonly check?: (body: string) => boolean;
  readonly example: string;
}

/** VAT body (the part after the country prefix) per scheme. */
const VAT_SCHEMES: Readonly<Record<string, VatScheme>> = {
  AT: { pattern: /^U\d{8}$/, example: "ATU13585627" },
  BE: { pattern: /^[01]\d{9}$/, check: checkBe, example: "BE0428759497" },
  BG: { pattern: /^\d{9,10}$/, example: "BG175074752" },
  CY: { pattern: /^\d{8}[A-Z]$/, example: "CY10259033P" },
  CZ: { pattern: /^\d{8,10}$/, example: "CZ25123891" },
  DE: { pattern: /^\d{9}$/, check: checkDe, example: "DE136695976" },
  DK: { pattern: /^\d{8}$/, check: checkDk, example: "DK13585628" },
  EE: { pattern: /^\d{9}$/, example: "EE100594102" },
  EL: { pattern: /^\d{9}$/, example: "EL094259216" },
  ES: { pattern: /^[A-Z0-9]\d{7}[A-Z0-9]$/, example: "ESA12345674" },
  FI: { pattern: /^\d{8}$/, check: checkFi, example: "FI20774740" },
  FR: { pattern: /^[0-9A-Z]{2}\d{9}$/, check: checkFr, example: "FR40303265045" },
  GB: { pattern: /^(\d{9}(\d{3})?|GD\d{3}|HA\d{3})$/, check: checkGb, example: "GB980780684" },
  HR: { pattern: /^\d{11}$/, example: "HR33392005961" },
  HU: { pattern: /^\d{8}$/, example: "HU12892312" },
  IE: { pattern: /^(\d{7}[A-W]|\d[A-Z*+]\d{5}[A-W]|\d{7}[A-W][AH])$/, example: "IE6388047V" },
  IT: { pattern: /^\d{11}$/, check: checkIt, example: "IT00743110157" },
  LT: { pattern: /^(\d{9}|\d{12})$/, example: "LT100001919017" },
  LU: { pattern: /^\d{8}$/, example: "LU26375245" },
  LV: { pattern: /^\d{11}$/, example: "LV40003009497" },
  MT: { pattern: /^\d{8}$/, example: "MT11679112" },
  NL: { pattern: /^\d{9}B\d{2}$/, check: checkNl, example: "NL004495445B01" },
  PL: { pattern: /^\d{10}$/, check: checkPl, example: "PL5260001246" },
  PT: { pattern: /^\d{9}$/, example: "PT501964843" },
  RO: { pattern: /^\d{2,10}$/, example: "RO18547290" },
  SE: { pattern: /^\d{12}$/, check: checkSe, example: "SE123456789701" },
  SI: { pattern: /^\d{8}$/, example: "SI50223054" },
  SK: { pattern: /^\d{10}$/, example: "SK2020270878" },
  CH: { pattern: /^E\d{9}(MWST|TVA|IVA)?$/, example: "CHE116281838MWST" },
  NO: { pattern: /^\d{9}(MVA)?$/, example: "NO974760673MVA" },
};

/**
 * Validates a VAT registration for a country. `value` may or may not carry the
 * country prefix; the verdict always does.
 */
export function validateVat(countryCodeValue: string, value: string): IdentifierVerdict {
  const prefix = vatPrefixFor(countryCodeValue);
  if (!prefix) {
    return verdict(false, compact(value), false, `unknown country "${countryCodeValue}"`);
  }
  const scheme = VAT_SCHEMES[prefix];
  const raw = compact(value);
  const body = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  const normalized = `${prefix}${body}`;

  if (!scheme) {
    return verdict(
      body.length >= 4,
      normalized,
      false,
      body.length >= 4 ? undefined : "too short to be a VAT registration",
    );
  }
  if (!scheme.pattern.test(body)) {
    return verdict(false, normalized, false, `does not match the ${prefix} format (e.g. ${scheme.example})`);
  }
  if (!scheme.check) return verdict(true, normalized, false);
  return scheme.check(body)
    ? verdict(true, normalized, true)
    : verdict(false, normalized, true, "check digit does not match");
}

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Indian GSTIN: state code + PAN + entity digit + Z + base-36 check character. */
export function validateGstin(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(normalized)) {
    return verdict(false, normalized, false, "does not match the 15-character GSTIN format");
  }
  let total = 0;
  for (let index = 0; index < 14; index += 1) {
    const digit = BASE36.indexOf(normalized[index]!);
    const product = digit * (index % 2 === 0 ? 1 : 2);
    total += Math.floor(product / 36) + (product % 36);
  }
  const expected = BASE36[(36 - (total % 36)) % 36];
  return expected === normalized[14]
    ? verdict(true, normalized, true)
    : verdict(false, normalized, true, `check character should be ${expected}`);
}

/** US Employer Identification Number: format only; the IRS publishes no check digit. */
export function validateEin(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^\d{9}$/.test(normalized)) {
    return verdict(false, normalized, false, "an EIN is nine digits (12-3456789)");
  }
  return verdict(true, `${normalized.slice(0, 2)}-${normalized.slice(2)}`, false);
}

/** Canadian Business Number: nine digits validated with Luhn. */
export function validateCanadianBn(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^\d{9}([A-Z]{2}\d{4})?$/.test(normalized)) {
    return verdict(false, normalized, false, "expected 9 digits, optionally plus a program account");
  }
  return luhn(normalized.slice(0, 9))
    ? verdict(true, normalized, true)
    : verdict(false, normalized, true, "check digit does not match");
}

/**
 * Country-aware tax registration check. Falls back to the VAT scheme for
 * countries that use one, and to national algorithms where they differ.
 */
export function validateTaxId(countryCodeValue: string, value: string): IdentifierVerdict {
  const country = findCountry(countryCodeValue);
  if (!country) return verdict(false, compact(value), false, `unknown country "${countryCodeValue}"`);
  switch (String(country.alpha2)) {
    case "US":
      return validateEin(value);
    case "CA":
      return validateCanadianBn(value);
    case "IN":
      return validateGstin(value);
    default:
      return validateVat(String(country.alpha2), value);
  }
}

/** GS1 mod-10 check digit over GTIN-8/12/13/14 and GLN/SSCC payloads. */
export function gs1CheckDigit(payload: string): number {
  const reversed = [...payload].reverse();
  const total = reversed.reduce(
    (sum, char, index) => sum + Number(char) * (index % 2 === 0 ? 3 : 1),
    0,
  );
  return (10 - (total % 10)) % 10;
}

/** Global Location Number: 13 digits with a GS1 check digit. */
export function validateGln(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^\d{13}$/.test(normalized)) {
    return verdict(false, normalized, false, "a GLN is 13 digits");
  }
  const expected = gs1CheckDigit(normalized.slice(0, 12));
  return expected === Number(normalized[12])
    ? verdict(true, normalized, true)
    : verdict(false, normalized, true, `check digit should be ${expected}`);
}

/** D-U-N-S: nine digits; Dun & Bradstreet retired the check digit in 2006. */
export function validateDuns(value: string): IdentifierVerdict {
  const normalized = compact(value);
  return /^\d{9}$/.test(normalized)
    ? verdict(true, normalized, false)
    : verdict(false, normalized, false, "a D-U-N-S number is nine digits");
}

/** ISO 7064 mod 97-10, shared by LEI and IBAN. */
function mod97(value: string): number {
  let remainder = 0;
  for (const char of value) {
    const digit = char >= "A" && char <= "Z" ? char.charCodeAt(0) - 55 : Number(char);
    remainder = digit > 9 ? (remainder * 100 + digit) % 97 : (remainder * 10 + digit) % 97;
  }
  return remainder;
}

/** Legal Entity Identifier (ISO 17442): 18 alphanumerics plus two check digits. */
export function validateLei(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^[A-Z0-9]{18}\d{2}$/.test(normalized)) {
    return verdict(false, normalized, false, "an LEI is 20 alphanumeric characters");
  }
  return mod97(normalized) === 1
    ? verdict(true, normalized, true)
    : verdict(false, normalized, true, "check digits do not match");
}

/** IBAN: length must match the country scheme and mod 97-10 must equal 1. */
export function validateIban(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(normalized)) {
    return verdict(false, normalized, false, "does not look like an IBAN");
  }
  const expectedLength = IBAN_LENGTHS[normalized.slice(0, 2)];
  if (expectedLength !== undefined && normalized.length !== expectedLength) {
    return verdict(
      false,
      normalized,
      false,
      `${normalized.slice(0, 2)} IBANs are ${expectedLength} characters, got ${normalized.length}`,
    );
  }
  const rearranged = `${normalized.slice(4)}${normalized.slice(0, 4)}`;
  return mod97(rearranged) === 1
    ? verdict(true, normalized, true)
    : verdict(false, normalized, true, "check digits do not match");
}

const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AT: 20, BE: 16, BG: 22, BH: 22, BR: 29, CH: 21, CY: 28, CZ: 24,
  DE: 22, DK: 18, EE: 20, ES: 24, FI: 18, FR: 27, GB: 22, GR: 27, HR: 21, HU: 28,
  IE: 22, IL: 23, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MT: 31,
  NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SA: 24, SE: 24, SI: 19, SK: 24, SM: 27,
  TR: 26, UA: 29,
};

/** SWIFT/BIC (ISO 9362): 8 or 11 characters, with a resolvable country code. */
export function validateBic(value: string): IdentifierVerdict {
  const normalized = compact(value);
  if (!/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(normalized)) {
    return verdict(false, normalized, false, "a BIC is 8 or 11 characters (BANKCCLL[BBB])");
  }
  const bicCountry = normalized.slice(4, 6);
  if (!findCountry(bicCountry)) {
    return verdict(false, normalized, false, `unknown country segment "${bicCountry}"`);
  }
  return verdict(true, normalized, false);
}

export interface PartyIdentifier {
  readonly scheme: IdentifierScheme;
  readonly value: string;
  /** Issuing country for schemes that are national (vat, tax). */
  readonly countryCode?: string;
  readonly verifiedAt?: string;
}

/**
 * Validates an identifier against its scheme, returning the canonical value.
 * Callers persist `normalized`, never the raw input, so uniqueness checks and
 * cross-system matching see one spelling.
 */
export function validateIdentifier(identifier: PartyIdentifier): IdentifierVerdict {
  switch (identifier.scheme) {
    case "vat":
      if (!identifier.countryCode) {
        return verdict(false, compact(identifier.value), false, "a VAT number needs a country");
      }
      return validateVat(identifier.countryCode, identifier.value);
    case "tax":
      if (!identifier.countryCode) {
        return verdict(false, compact(identifier.value), false, "a tax id needs a country");
      }
      return validateTaxId(identifier.countryCode, identifier.value);
    case "duns":
      return validateDuns(identifier.value);
    case "gln":
      return validateGln(identifier.value);
    case "lei":
      return validateLei(identifier.value);
    case "iban":
      return validateIban(identifier.value);
    case "bic":
      return validateBic(identifier.value);
    case "internal": {
      const normalized = identifier.value.trim().toUpperCase();
      return normalized.length > 0
        ? verdict(true, normalized, false)
        : verdict(false, normalized, false, "internal identifiers cannot be blank");
    }
    default:
      throw ValidationError.single("scheme", `unknown identifier scheme "${identifier.scheme}"`);
  }
}

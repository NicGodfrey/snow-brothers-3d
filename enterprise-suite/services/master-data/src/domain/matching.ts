import { addressFingerprint, type PostalAddress } from "./address.js";
import type { PartyIdentifier } from "./identifiers.js";

/**
 * Duplicate detection for party master data.
 *
 * Deduplication runs on a projection (`MatchProfile`) rather than on the
 * aggregate, so the same scoring works for a stored customer, a row from a
 * CSV import and a payload from an inbound integration.
 *
 * The score combines four independent signals — registration identifiers,
 * name similarity, address similarity and contact domain — because any one of
 * them alone is unreliable: two branches share an address, two unrelated firms
 * share a name, and typos break exact identifier matching. A shared,
 * check-digit-validated identifier is treated as decisive; everything else
 * accumulates towards a review threshold.
 */

export interface MatchProfile {
  readonly id?: string;
  readonly legalName: string;
  readonly tradingName?: string;
  readonly identifiers?: readonly PartyIdentifier[];
  readonly address?: PostalAddress;
  readonly emailDomains?: readonly string[];
}

export type MatchDecision = "duplicate" | "review" | "distinct";

export interface MatchSignal {
  readonly kind: "identifier" | "name" | "address" | "contact" | "country";
  readonly weight: number;
  readonly contribution: number;
  readonly detail: string;
}

export interface MatchScore {
  readonly score: number;
  readonly decision: MatchDecision;
  readonly signals: readonly MatchSignal[];
}

/** Legal-form suffixes dropped before comparing company names. */
const LEGAL_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "plc", "co", "corp", "corporation",
  "company", "gmbh", "mbh", "ag", "kg", "kgaa", "ohg", "gbr", "ug", "sa", "sas", "sarl", "sca",
  "sprl", "nv", "bv", "cv", "vof", "aps", "as", "asa", "ab", "oy", "oyj", "spa", "srl", "snc",
  "sl", "slu", "sau", "pty", "pte", "sdn", "bhd", "kk", "kabushiki", "gk", "zoo", "sp", "sro",
  "kft", "zrt", "dooel", "doo", "ood", "eood", "ad", "pjsc", "jsc", "ojsc", "llp",
]);

const NOISE_WORDS = new Set(["the", "and", "of", "for", "group", "holding", "holdings", "intl", "international"]);

export function normalizeCompanyName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function nameTokens(name: string): readonly string[] {
  return normalizeCompanyName(name)
    .split(" ")
    .filter((token) => token.length > 0 && !LEGAL_SUFFIXES.has(token) && !NOISE_WORDS.has(token));
}

/** Levenshtein edit distance with a rolling single-row buffer. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * Jaro-Winkler similarity. Company names diverge mostly in their tails
 * ("Acme Manufacturing" vs "Acme Mfg"), and the Winkler prefix bonus rewards
 * the shared head, which matches how a data steward eyeballs them.
 */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);
  let matches = 0;

  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }
  const half = transpositions / 2;
  const jaro = (matches / a.length + matches / b.length + (matches - half) / matches) / 3;

  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix += 1;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Sørensen-Dice coefficient over token sets, robust to word reordering. */
export function tokenSetSimilarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return (2 * shared) / (setA.size + setB.size);
}

/**
 * Similarity of two organisation names: the better of a character-level and a
 * token-level comparison, so both "Acme Ltd"/"ACME Limited" (character) and
 * "Northwind Trading"/"Trading Northwind" (token) score high.
 */
export function nameSimilarity(a: string, b: string): number {
  const normalizedA = nameTokens(a).join(" ");
  const normalizedB = nameTokens(b).join(" ");
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0;
  if (normalizedA === normalizedB) return 1;
  return Math.max(
    jaroWinkler(normalizedA, normalizedB),
    tokenSetSimilarity(nameTokens(a), nameTokens(b)),
  );
}

/** Identifiers strong enough to settle a match on their own. */
const DECISIVE_SCHEMES = new Set(["vat", "tax", "duns", "gln", "lei"]);

function sharedIdentifier(
  a: readonly PartyIdentifier[] = [],
  b: readonly PartyIdentifier[] = [],
): PartyIdentifier | undefined {
  for (const left of a) {
    if (!DECISIVE_SCHEMES.has(left.scheme)) continue;
    const hit = b.find(
      (right) =>
        right.scheme === left.scheme &&
        right.value.toUpperCase() === left.value.toUpperCase() &&
        (right.countryCode ?? "") === (left.countryCode ?? ""),
    );
    if (hit) return hit;
  }
  return undefined;
}

export interface MatchThresholds {
  readonly duplicate: number;
  readonly review: number;
}

export const DEFAULT_THRESHOLDS: MatchThresholds = { duplicate: 0.86, review: 0.62 };

/**
 * Scores two profiles against each other.
 *
 * Weights sum to 1 across name (0.5), address (0.35) and contact domain
 * (0.15). A shared decisive identifier short-circuits to 1.0. Different
 * countries cap the score below the duplicate threshold: cross-border entities
 * are legally distinct even when the branding matches, so they go to review
 * instead of being auto-merged.
 */
export function scoreMatch(
  a: MatchProfile,
  b: MatchProfile,
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): MatchScore {
  const signals: MatchSignal[] = [];

  const shared = sharedIdentifier(a.identifiers, b.identifiers);
  if (shared) {
    signals.push({
      kind: "identifier",
      weight: 1,
      contribution: 1,
      detail: `shared ${shared.scheme} ${shared.value}`,
    });
    return { score: 1, decision: "duplicate", signals };
  }

  const nameScore = Math.max(
    nameSimilarity(a.legalName, b.legalName),
    a.tradingName && b.tradingName ? nameSimilarity(a.tradingName, b.tradingName) : 0,
    a.tradingName ? nameSimilarity(a.tradingName, b.legalName) : 0,
    b.tradingName ? nameSimilarity(a.legalName, b.tradingName) : 0,
  );

  let addressScore = 0;
  let addressDetail = "no address to compare";
  if (a.address && b.address) {
    if (addressFingerprint(a.address) === addressFingerprint(b.address)) {
      addressScore = 1;
      addressDetail = "identical normalized address";
    } else {
      const samePostal =
        Boolean(a.address.postalCode) &&
        a.address.postalCode?.replace(/\W/g, "") === b.address.postalCode?.replace(/\W/g, "");
      const sameCity = a.address.city.toLowerCase() === b.address.city.toLowerCase();
      const sameStreet =
        nameSimilarity(a.address.line1, b.address.line1) > 0.9 && (samePostal || sameCity);
      addressScore = sameStreet ? 0.85 : samePostal && sameCity ? 0.5 : sameCity ? 0.25 : 0;
      addressDetail = sameStreet
        ? "same street, same locality"
        : samePostal && sameCity
          ? "same city and postal code"
          : sameCity
            ? "same city"
            : "different locality";
    }
  }
  // The same name at the same doorstep is decisive on its own; waiting for a
  // shared email domain to cross the threshold would leave the clearest kind
  // of duplicate sitting in a review queue.
  if (nameScore === 1 && addressScore === 1) {
    signals.push({
      kind: "name",
      weight: 1,
      contribution: 1,
      detail: "identical name at an identical address",
    });
    return { score: 1, decision: "duplicate", signals };
  }

  signals.push({
    kind: "name",
    weight: 0.5,
    contribution: nameScore * 0.5,
    detail: `name similarity ${nameScore.toFixed(3)}`,
  });
  signals.push({
    kind: "address",
    weight: 0.35,
    contribution: addressScore * 0.35,
    detail: addressDetail,
  });

  const domainsA = new Set((a.emailDomains ?? []).map((d) => d.toLowerCase()));
  const domainsB = new Set((b.emailDomains ?? []).map((d) => d.toLowerCase()));
  const sharedDomain = [...domainsA].find((d) => domainsB.has(d));
  signals.push({
    kind: "contact",
    weight: 0.15,
    contribution: sharedDomain ? 0.15 : 0,
    detail: sharedDomain ? `shared email domain ${sharedDomain}` : "no shared email domain",
  });

  let score = signals.reduce((sum, signal) => sum + signal.contribution, 0);

  const countryA = a.address?.countryCode;
  const countryB = b.address?.countryCode;
  if (countryA && countryB && countryA !== countryB) {
    const capped = Math.min(score, thresholds.duplicate - 0.01);
    signals.push({
      kind: "country",
      weight: 0,
      contribution: capped - score,
      detail: `different countries (${countryA} vs ${countryB}) — never auto-merged`,
    });
    score = capped;
  }

  const rounded = Math.round(score * 1000) / 1000;
  const decision: MatchDecision =
    rounded >= thresholds.duplicate ? "duplicate" : rounded >= thresholds.review ? "review" : "distinct";
  return { score: rounded, decision, signals };
}

export interface MatchCandidate<T> {
  readonly record: T;
  readonly score: MatchScore;
}

/** Ranks candidates against a probe, dropping anything below the review bar. */
export function rankMatches<T>(
  probe: MatchProfile,
  candidates: readonly T[],
  toProfile: (record: T) => MatchProfile,
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): readonly MatchCandidate<T>[] {
  return candidates
    .map((record) => ({ record, score: scoreMatch(probe, toProfile(record), thresholds) }))
    .filter((candidate) => candidate.score.score >= thresholds.review)
    .sort((a, b) => b.score.score - a.score.score);
}

export interface FieldConflict {
  readonly field: string;
  readonly survivor: unknown;
  readonly duplicate: unknown;
}

/**
 * Field-level diff between two profiles, shown to a steward before a merge so
 * they can see exactly what the losing record would take with it.
 */
export function mergeConflicts(survivor: MatchProfile, duplicate: MatchProfile): readonly FieldConflict[] {
  const conflicts: FieldConflict[] = [];
  const compare = (field: string, left: unknown, right: unknown): void => {
    if (left !== undefined && right !== undefined && JSON.stringify(left) !== JSON.stringify(right)) {
      conflicts.push({ field, survivor: left, duplicate: right });
    }
  };
  compare("legalName", survivor.legalName, duplicate.legalName);
  compare("tradingName", survivor.tradingName, duplicate.tradingName);
  if (survivor.address && duplicate.address) {
    compare("address", addressFingerprint(survivor.address), addressFingerprint(duplicate.address));
  }
  for (const identifier of duplicate.identifiers ?? []) {
    const counterpart = (survivor.identifiers ?? []).find((i) => i.scheme === identifier.scheme);
    if (counterpart && counterpart.value !== identifier.value) {
      conflicts.push({
        field: `identifiers.${identifier.scheme}`,
        survivor: counterpart.value,
        duplicate: identifier.value,
      });
    }
  }
  return conflicts;
}

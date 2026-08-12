import { ValidationError } from "./errors.js";

/**
 * Human-facing document numbers. Partners quote these on the phone, so they
 * are short, per-tenant sequential and prefixed by document kind.
 */

export const NUMBER_PREFIXES = {
  dealRegistration: "DR",
  referral: "REF",
  channelQuote: "CQ",
  channelOrder: "CO",
  conflict: "CNF",
} as const;

export type SequenceName = keyof typeof NUMBER_PREFIXES;

export const SEQUENCE_NAMES: readonly SequenceName[] = Object.keys(NUMBER_PREFIXES) as SequenceName[];

const WIDTH = 5;

export function formatNumber(sequence: SequenceName, value: number): string {
  if (!Number.isInteger(value) || value < 1) {
    throw ValidationError.single("sequence", "must be a positive integer");
  }
  return `${NUMBER_PREFIXES[sequence]}-${String(value).padStart(WIDTH, "0")}`;
}

export function parseNumber(value: string): { sequence: SequenceName; value: number } | undefined {
  const match = /^([A-Z]+)-([0-9]{5,})$/.exec(value.trim().toUpperCase());
  if (!match) return undefined;
  const entry = SEQUENCE_NAMES.find((name) => NUMBER_PREFIXES[name] === match[1]);
  if (!entry) return undefined;
  return { sequence: entry, value: Number(match[2]) };
}

export function isNumberOf(sequence: SequenceName, value: string): boolean {
  const parsed = parseNumber(value);
  return parsed?.sequence === sequence;
}

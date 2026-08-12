import { ValidationError } from "./errors.js";

/** Document families that carry a human-readable, gap-free-per-year number. */
export type DocumentSeries = "PR" | "RFQ" | "QT" | "PO" | "GRN" | "INV" | "BPA";

export const DOCUMENT_SERIES: readonly DocumentSeries[] = [
  "PR",
  "RFQ",
  "QT",
  "PO",
  "GRN",
  "INV",
  "BPA",
];

const SEQUENCE_WIDTH = 6;

/**
 * Formats `PR-2026-000042`. Buyers and suppliers quote these numbers on
 * emails and packing slips, so the format is part of the public contract.
 */
export function formatDocumentNumber(series: DocumentSeries, year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) {
    throw ValidationError.single("year", `must be a 4-digit year, got ${year}`);
  }
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw ValidationError.single("sequence", `must be a positive integer, got ${sequence}`);
  }
  return `${series}-${year}-${String(sequence).padStart(SEQUENCE_WIDTH, "0")}`;
}

export interface ParsedDocumentNumber {
  readonly series: DocumentSeries;
  readonly year: number;
  readonly sequence: number;
}

export function parseDocumentNumber(value: string): ParsedDocumentNumber {
  const match = /^([A-Z]{2,3})-(\d{4})-(\d{6,})$/.exec(value.trim().toUpperCase());
  if (!match) {
    throw ValidationError.single("documentNumber", `must look like PO-2026-000001, got "${value}"`);
  }
  const [, series, year, sequence] = match;
  if (!DOCUMENT_SERIES.includes(series as DocumentSeries)) {
    throw ValidationError.single("documentNumber", `unknown series "${series}"`);
  }
  return {
    series: series as DocumentSeries,
    year: Number(year),
    sequence: Number(sequence),
  };
}

/** Supplier-provided invoice references are normalised before duplicate checks. */
export function normalizeSupplierReference(value: string): string {
  const normalized = value.trim().toUpperCase().replace(/[\s._-]+/g, "");
  if (normalized.length === 0 || normalized.length > 60) {
    throw ValidationError.single("supplierReference", `must be 1-60 characters, got "${value}"`);
  }
  return normalized;
}

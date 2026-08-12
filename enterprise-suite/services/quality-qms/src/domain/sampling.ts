/**
 * Sampling determination for inspection lots.
 *
 * Supports four rules:
 *  - "full"        : 100% inspection
 *  - "fixed"       : constant sample size
 *  - "percentage"  : percentage of lot size with min/max clamps
 *  - "aql"         : single sampling plan for normal inspection modelled on
 *                    ISO 2859-1 / ANSI Z1.4 (general inspection levels I-III)
 *
 * The AQL implementation reproduces the structure of Table 1 (sample size
 * code letters) and Table 2-A (single sampling, normal inspection):
 * lot-size ranges map to a code letter per inspection level, and each code
 * letter has a fixed sample size. Within an AQL column (top to bottom):
 *   - rows above the first Ac=0 row are down-arrows (use the Ac=0 plan)
 *   - the Ac=0 row
 *   - the next TWO rows are down-arrows resolving to the Ac=1 plan
 *   - then one acceptance step per row: 1, 2, 3, 5, 7, 10, 14, 21
 *   - rows past Ac=21 are up-arrows (use the Ac=21 plan)
 * e.g. AQL 1.0: (13,0), (50,1), (80,2), (125,3), (200,5), (315,7), ...
 * which matches the published single/normal plans.
 */
import { DomainError } from "@enterprise-suite/shared-kernel";

export type InspectionLevel = "I" | "II" | "III";

/** AQL values supported by this plan table (percent defective). */
export const SUPPORTED_AQLS = [0.065, 0.1, 0.15, 0.25, 0.4, 0.65, 1.0, 1.5, 2.5, 4.0, 6.5] as const;
export type AqlValue = (typeof SUPPORTED_AQLS)[number];

export type SamplingRule =
  | { readonly kind: "full" }
  | { readonly kind: "fixed"; readonly sampleSize: number }
  | {
      readonly kind: "percentage";
      readonly percent: number;
      readonly minimum: number;
      readonly maximum?: number;
    }
  | { readonly kind: "aql"; readonly level: InspectionLevel; readonly aql: AqlValue };

export interface SamplingOutcome {
  /** Units to inspect. Never exceeds the lot quantity. */
  readonly sampleSize: number;
  /** Max defective units for an attribute characteristic to still accept. */
  readonly acceptanceNumber: number;
  /** Min defective units that force rejection (acceptanceNumber + 1). */
  readonly rejectionNumber: number;
  /** Human-readable description, persisted on the lot for traceability. */
  readonly description: string;
}

// --- Table 1: lot-size ranges -> code letters per general inspection level ---

const CODE_LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R"] as const;
type CodeLetter = (typeof CODE_LETTERS)[number];

const SAMPLE_SIZE_BY_LETTER: Record<CodeLetter, number> = {
  A: 2, B: 3, C: 5, D: 8, E: 13, F: 20, G: 32, H: 50,
  J: 80, K: 125, L: 200, M: 315, N: 500, P: 800, Q: 1250, R: 2000,
};

interface LotSizeRow {
  readonly maxLotSize: number; // inclusive upper bound
  readonly letters: Record<InspectionLevel, CodeLetter>;
}

const LOT_SIZE_TABLE: readonly LotSizeRow[] = [
  { maxLotSize: 8, letters: { I: "A", II: "A", III: "B" } },
  { maxLotSize: 15, letters: { I: "A", II: "B", III: "C" } },
  { maxLotSize: 25, letters: { I: "B", II: "C", III: "D" } },
  { maxLotSize: 50, letters: { I: "C", II: "D", III: "E" } },
  { maxLotSize: 90, letters: { I: "C", II: "E", III: "F" } },
  { maxLotSize: 150, letters: { I: "D", II: "F", III: "G" } },
  { maxLotSize: 280, letters: { I: "E", II: "G", III: "H" } },
  { maxLotSize: 500, letters: { I: "F", II: "H", III: "J" } },
  { maxLotSize: 1200, letters: { I: "G", II: "J", III: "K" } },
  { maxLotSize: 3200, letters: { I: "H", II: "K", III: "L" } },
  { maxLotSize: 10_000, letters: { I: "J", II: "L", III: "M" } },
  { maxLotSize: 35_000, letters: { I: "K", II: "M", III: "N" } },
  { maxLotSize: 150_000, letters: { I: "L", II: "N", III: "P" } },
  { maxLotSize: 500_000, letters: { I: "M", II: "P", III: "Q" } },
  { maxLotSize: Number.MAX_SAFE_INTEGER, letters: { I: "N", II: "Q", III: "R" } },
];

// --- Table 2-A structure: first code letter with Ac=0 per AQL column ---

const FIRST_ZERO_LETTER_BY_AQL: Record<AqlValue, CodeLetter> = {
  6.5: "A",
  4.0: "B",
  2.5: "C",
  1.5: "D",
  1.0: "E",
  0.65: "F",
  0.4: "G",
  0.25: "H",
  0.15: "J",
  0.1: "K",
  0.065: "L",
};

/**
 * Acceptance number by row offset from the Ac=0 row. Offsets 1 and 2 are
 * the arrow rows that resolve down to the Ac=1 plan (offset 3).
 */
const AC_BY_OFFSET: Record<number, number> = {
  0: 0, 3: 1, 4: 2, 5: 3, 6: 5, 7: 7, 8: 10, 9: 14, 10: 21,
};
const MAX_OFFSET = 10;

export function codeLetterFor(lotSize: number, level: InspectionLevel): CodeLetter {
  if (!Number.isFinite(lotSize) || lotSize < 2) {
    throw new DomainError(`AQL sampling requires lot size >= 2, got ${lotSize}`, "INVALID_LOT_SIZE");
  }
  const row = LOT_SIZE_TABLE.find((r) => lotSize <= r.maxLotSize)!;
  return row.letters[level];
}

export function aqlSingleNormalPlan(
  lotSize: number,
  level: InspectionLevel,
  aql: AqlValue,
): { sampleSize: number; acceptanceNumber: number; codeLetter: CodeLetter } {
  const nominalLetter = codeLetterFor(lotSize, level);
  const nominalIdx = CODE_LETTERS.indexOf(nominalLetter);
  const zeroIdx = CODE_LETTERS.indexOf(FIRST_ZERO_LETTER_BY_AQL[aql]);

  let offset = nominalIdx - zeroIdx;
  if (offset < 0) {
    offset = 0; // above the Ac=0 row: arrow down to the Ac=0 plan
  } else if (offset === 1 || offset === 2) {
    offset = 3; // arrow rows below Ac=0: resolve down to the Ac=1 plan
  } else if (offset > MAX_OFFSET) {
    offset = MAX_OFFSET; // below the Ac=21 row: arrow up to the Ac=21 plan
  }

  const letter = CODE_LETTERS[zeroIdx + offset]!;
  return {
    sampleSize: SAMPLE_SIZE_BY_LETTER[letter],
    acceptanceNumber: AC_BY_OFFSET[offset]!,
    codeLetter: letter,
  };
}

export function determineSampling(rule: SamplingRule, lotQuantity: number): SamplingOutcome {
  if (!Number.isFinite(lotQuantity) || lotQuantity <= 0) {
    throw new DomainError(`Lot quantity must be positive, got ${lotQuantity}`, "INVALID_LOT_QUANTITY");
  }
  const qty = Math.floor(lotQuantity);

  switch (rule.kind) {
    case "full":
      return {
        sampleSize: qty,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        description: `100% inspection of ${qty} units`,
      };
    case "fixed": {
      if (rule.sampleSize < 1) {
        throw new DomainError("Fixed sample size must be >= 1", "INVALID_SAMPLING_RULE");
      }
      const n = Math.min(rule.sampleSize, qty);
      return {
        sampleSize: n,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        description: `Fixed sample of ${n} units (rule: ${rule.sampleSize})`,
      };
    }
    case "percentage": {
      if (rule.percent <= 0 || rule.percent > 100) {
        throw new DomainError("Percentage must be in (0, 100]", "INVALID_SAMPLING_RULE");
      }
      const raw = Math.ceil((qty * rule.percent) / 100);
      const clamped = Math.min(
        rule.maximum ?? Number.MAX_SAFE_INTEGER,
        Math.max(rule.minimum, raw),
      );
      const n = Math.min(clamped, qty);
      return {
        sampleSize: n,
        acceptanceNumber: 0,
        rejectionNumber: 1,
        description: `${rule.percent}% sample (min ${rule.minimum}${rule.maximum ? `, max ${rule.maximum}` : ""}) => ${n} units`,
      };
    }
    case "aql": {
      const plan = aqlSingleNormalPlan(Math.max(qty, 2), rule.level, rule.aql);
      if (plan.sampleSize >= qty) {
        // Standard rule: when the sample equals/exceeds the lot, do 100%.
        return {
          sampleSize: qty,
          acceptanceNumber: plan.acceptanceNumber,
          rejectionNumber: plan.acceptanceNumber + 1,
          description: `AQL ${rule.aql} level ${rule.level}: sample >= lot, 100% inspection (Ac=${plan.acceptanceNumber})`,
        };
      }
      return {
        sampleSize: plan.sampleSize,
        acceptanceNumber: plan.acceptanceNumber,
        rejectionNumber: plan.acceptanceNumber + 1,
        description: `AQL ${rule.aql} level ${rule.level}, code letter ${plan.codeLetter}: n=${plan.sampleSize}, Ac=${plan.acceptanceNumber}, Re=${plan.acceptanceNumber + 1}`,
      };
    }
  }
}

export function validateSamplingRule(rule: SamplingRule): void {
  switch (rule.kind) {
    case "full":
      return;
    case "fixed":
      if (!Number.isInteger(rule.sampleSize) || rule.sampleSize < 1) {
        throw new DomainError("Fixed sample size must be a positive integer", "INVALID_SAMPLING_RULE");
      }
      return;
    case "percentage":
      if (rule.percent <= 0 || rule.percent > 100) {
        throw new DomainError("Percentage must be in (0, 100]", "INVALID_SAMPLING_RULE");
      }
      if (!Number.isInteger(rule.minimum) || rule.minimum < 1) {
        throw new DomainError("Percentage minimum must be a positive integer", "INVALID_SAMPLING_RULE");
      }
      if (rule.maximum !== undefined && rule.maximum < rule.minimum) {
        throw new DomainError("Percentage maximum must be >= minimum", "INVALID_SAMPLING_RULE");
      }
      return;
    case "aql":
      if (!SUPPORTED_AQLS.includes(rule.aql)) {
        throw new DomainError(
          `Unsupported AQL ${rule.aql}; supported: ${SUPPORTED_AQLS.join(", ")}`,
          "INVALID_SAMPLING_RULE",
        );
      }
      return;
  }
}

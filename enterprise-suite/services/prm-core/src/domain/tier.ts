import {
  money,
  newId,
  nowIso,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { ValidationError } from "./errors.js";
import { formatMoney } from "./money.js";

/**
 * Partner tier program.
 *
 * A tier is a named rank with entry requirements and benefits. Tiers are
 * tenant-defined records (not aggregates) because they change through program
 * design, not through transactions; a partner's *assignment* to a tier is the
 * transactional part and lives on the Partner aggregate.
 *
 * The evaluation function is deliberately pure: it takes a measured snapshot
 * of a partner and returns, per tier, whether the partner qualifies and which
 * requirements are missing. Services decide what to do with that (auto-assign,
 * warn, schedule a downgrade at renewal).
 */

export interface TierRequirements {
  /** Trailing-window booked revenue, in the tier program's currency. */
  readonly minTrailingRevenueMinor?: number;
  /** Distinct individuals holding at least one active certification. */
  readonly minCertifiedIndividuals?: number;
  /** Specific certifications the partner must hold somewhere in its org. */
  readonly requiredCertificationCodes?: readonly string[];
  readonly minDealsWon?: number;
  readonly minMonthsActive?: number;
  readonly requiresSignedContract?: boolean;
}

export type SupportLevel = "standard" | "priority" | "dedicated";

export interface TierBenefits {
  /** Standing discount off list, in basis points. */
  readonly baseDiscountBps: number;
  /** Extra discount when a deal is registered and approved. */
  readonly dealRegistrationBonusBps: number;
  /** Share of partner-booked revenue accruing into the MDF pool. */
  readonly mdfAccrualBps: number;
  /** Cap on a single MDF fund request, as a share of the partner allocation. */
  readonly mdfRequestCapBps: number;
  readonly leadSharing: boolean;
  readonly namedChannelManager: boolean;
  readonly supportLevel: SupportLevel;
  /** Not-for-resale license seats included with the tier. */
  readonly nfrSeats: number;
}

export interface TierDefinition {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly code: string;
  readonly name: string;
  /** Higher rank = better tier. Unique per tenant. */
  readonly rank: number;
  readonly requirements: TierRequirements;
  readonly benefits: TierBenefits;
  readonly currency: string;
  readonly active: boolean;
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

export interface CreateTierInput {
  readonly code: string;
  readonly name: string;
  readonly rank: number;
  readonly requirements?: TierRequirements;
  readonly benefits: TierBenefits;
  readonly currency?: string;
  readonly active?: boolean;
}

const TIER_CODE_PATTERN = /^[a-z][a-z0-9_-]{1,30}$/;

function validateBenefits(benefits: TierBenefits): void {
  const bpsFields: [keyof TierBenefits, number][] = [
    ["baseDiscountBps", benefits.baseDiscountBps],
    ["dealRegistrationBonusBps", benefits.dealRegistrationBonusBps],
    ["mdfAccrualBps", benefits.mdfAccrualBps],
    ["mdfRequestCapBps", benefits.mdfRequestCapBps],
  ];
  for (const [field, value] of bpsFields) {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
      throw ValidationError.single(`benefits.${String(field)}`, "must be an integer between 0 and 10000");
    }
  }
  if (!Number.isInteger(benefits.nfrSeats) || benefits.nfrSeats < 0) {
    throw ValidationError.single("benefits.nfrSeats", "must be a non-negative integer");
  }
}

function validateRequirements(requirements: TierRequirements): void {
  const numeric: [string, number | undefined][] = [
    ["minTrailingRevenueMinor", requirements.minTrailingRevenueMinor],
    ["minCertifiedIndividuals", requirements.minCertifiedIndividuals],
    ["minDealsWon", requirements.minDealsWon],
    ["minMonthsActive", requirements.minMonthsActive],
  ];
  for (const [field, value] of numeric) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 0) {
      throw ValidationError.single(`requirements.${field}`, "must be a non-negative integer");
    }
  }
}

export function createTierDefinition(tenantId: TenantId, input: CreateTierInput): TierDefinition {
  const code = input.code.trim().toLowerCase();
  if (!TIER_CODE_PATTERN.test(code)) {
    throw ValidationError.single("code", "must be lowercase alphanumeric with - or _, 2-31 chars");
  }
  if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");
  if (!Number.isInteger(input.rank) || input.rank < 0 || input.rank > 100) {
    throw ValidationError.single("rank", "must be an integer between 0 and 100");
  }
  const requirements = input.requirements ?? {};
  validateRequirements(requirements);
  validateBenefits(input.benefits);
  const now = nowIso();
  return {
    id: newId("tier"),
    tenantId,
    code,
    name: input.name.trim(),
    rank: input.rank,
    requirements,
    benefits: input.benefits,
    currency: (input.currency ?? "USD").toUpperCase(),
    active: input.active ?? true,
    createdAt: now,
    updatedAt: now,
  };
}

/** Reference program shipped with the service; tenants may replace it wholesale. */
export const STANDARD_TIERS: readonly CreateTierInput[] = [
  {
    code: "registered",
    name: "Registered",
    rank: 10,
    requirements: { requiresSignedContract: true },
    benefits: {
      baseDiscountBps: 500,
      dealRegistrationBonusBps: 300,
      mdfAccrualBps: 0,
      mdfRequestCapBps: 10_000,
      leadSharing: false,
      namedChannelManager: false,
      supportLevel: "standard",
      nfrSeats: 1,
    },
  },
  {
    code: "silver",
    name: "Silver",
    rank: 20,
    requirements: {
      requiresSignedContract: true,
      minTrailingRevenueMinor: 5_000_000,
      minCertifiedIndividuals: 2,
      minMonthsActive: 3,
    },
    benefits: {
      baseDiscountBps: 1000,
      dealRegistrationBonusBps: 500,
      mdfAccrualBps: 100,
      mdfRequestCapBps: 5000,
      leadSharing: false,
      namedChannelManager: false,
      supportLevel: "standard",
      nfrSeats: 3,
    },
  },
  {
    code: "gold",
    name: "Gold",
    rank: 30,
    requirements: {
      requiresSignedContract: true,
      minTrailingRevenueMinor: 25_000_000,
      minCertifiedIndividuals: 4,
      requiredCertificationCodes: ["sales-pro", "tech-pro"],
      minDealsWon: 5,
      minMonthsActive: 6,
    },
    benefits: {
      baseDiscountBps: 1500,
      dealRegistrationBonusBps: 700,
      mdfAccrualBps: 200,
      mdfRequestCapBps: 4000,
      leadSharing: true,
      namedChannelManager: true,
      supportLevel: "priority",
      nfrSeats: 10,
    },
  },
  {
    code: "platinum",
    name: "Platinum",
    rank: 40,
    requirements: {
      requiresSignedContract: true,
      minTrailingRevenueMinor: 100_000_000,
      minCertifiedIndividuals: 10,
      requiredCertificationCodes: ["sales-pro", "tech-pro", "tech-expert"],
      minDealsWon: 20,
      minMonthsActive: 12,
    },
    benefits: {
      baseDiscountBps: 2200,
      dealRegistrationBonusBps: 900,
      mdfAccrualBps: 350,
      mdfRequestCapBps: 3000,
      leadSharing: true,
      namedChannelManager: true,
      supportLevel: "dedicated",
      nfrSeats: 25,
    },
  },
];

/** Measured facts about a partner at evaluation time. */
export interface TierEvaluationInput {
  readonly trailingRevenue: Money;
  readonly certifiedIndividuals: number;
  readonly heldCertificationCodes: readonly string[];
  readonly dealsWon: number;
  readonly monthsActive: number;
  readonly hasActiveContract: boolean;
  readonly currentTierCode?: string;
}

export interface TierGap {
  readonly requirement: string;
  readonly required: string;
  readonly actual: string;
}

export interface TierQualification {
  readonly tierCode: string;
  readonly rank: number;
  readonly qualifies: boolean;
  readonly gaps: readonly TierGap[];
}

export interface TierEvaluation {
  readonly qualifications: readonly TierQualification[];
  /** Highest-ranked tier whose requirements are all met. */
  readonly eligibleTierCode?: string;
  readonly eligibleRank: number;
  readonly currentTierCode?: string;
  readonly currentRank: number;
  readonly recommendation: "initial" | "upgrade" | "downgrade" | "hold";
  /** Gaps blocking the next tier up, if any tier ranks above the eligible one. */
  readonly gapsToNextTier: readonly TierGap[];
}

/**
 * Scores a partner against every active tier. A tier qualifies only when all
 * of its requirements are met; requirements are additive, never averaged, so
 * a partner cannot buy its way past a certification bar with revenue.
 */
export function evaluateTier(
  definitions: readonly TierDefinition[],
  input: TierEvaluationInput,
): TierEvaluation {
  const active = definitions.filter((t) => t.active).sort((a, b) => a.rank - b.rank);
  const held = new Set(input.heldCertificationCodes.map((c) => c.trim().toLowerCase()));
  const qualifications: TierQualification[] = active.map((tier) => {
    const gaps: TierGap[] = [];
    const req = tier.requirements;

    if (req.requiresSignedContract && !input.hasActiveContract) {
      gaps.push({ requirement: "signedContract", required: "an active contract", actual: "none" });
    }
    if (req.minTrailingRevenueMinor !== undefined) {
      if (input.trailingRevenue.currency !== tier.currency) {
        gaps.push({
          requirement: "trailingRevenue",
          required: `revenue reported in ${tier.currency}`,
          actual: input.trailingRevenue.currency,
        });
      } else if (input.trailingRevenue.amountMinor < req.minTrailingRevenueMinor) {
        gaps.push({
          requirement: "trailingRevenue",
          required: formatMoney(money(req.minTrailingRevenueMinor, tier.currency)),
          actual: formatMoney(input.trailingRevenue),
        });
      }
    }
    if (req.minCertifiedIndividuals !== undefined && input.certifiedIndividuals < req.minCertifiedIndividuals) {
      gaps.push({
        requirement: "certifiedIndividuals",
        required: String(req.minCertifiedIndividuals),
        actual: String(input.certifiedIndividuals),
      });
    }
    for (const code of req.requiredCertificationCodes ?? []) {
      if (!held.has(code.trim().toLowerCase())) {
        gaps.push({ requirement: "certification", required: code, actual: "not held" });
      }
    }
    if (req.minDealsWon !== undefined && input.dealsWon < req.minDealsWon) {
      gaps.push({ requirement: "dealsWon", required: String(req.minDealsWon), actual: String(input.dealsWon) });
    }
    if (req.minMonthsActive !== undefined && input.monthsActive < req.minMonthsActive) {
      gaps.push({
        requirement: "monthsActive",
        required: String(req.minMonthsActive),
        actual: String(input.monthsActive),
      });
    }
    return { tierCode: tier.code, rank: tier.rank, qualifies: gaps.length === 0, gaps };
  });

  const eligible = [...qualifications].reverse().find((q) => q.qualifies);
  const current = active.find((t) => t.code === input.currentTierCode);
  const currentRank = current?.rank ?? 0;
  const eligibleRank = eligible?.rank ?? 0;
  const next = qualifications.find((q) => q.rank > eligibleRank);

  let recommendation: TierEvaluation["recommendation"];
  if (input.currentTierCode === undefined) recommendation = eligible ? "initial" : "hold";
  else if (eligibleRank > currentRank) recommendation = "upgrade";
  else if (eligibleRank < currentRank) recommendation = "downgrade";
  else recommendation = "hold";

  return {
    qualifications,
    eligibleTierCode: eligible?.tierCode,
    eligibleRank,
    currentTierCode: input.currentTierCode,
    currentRank,
    recommendation,
    gapsToNextTier: next?.gaps ?? [],
  };
}

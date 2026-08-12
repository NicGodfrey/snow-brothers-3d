import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { CategoryPolicy } from "./category.js";
import type { Certification, CertificationType } from "./certification.js";
import type { Contract } from "./contract.js";
import type { DateOnly } from "./dates.js";
import type { Qualification } from "./qualification.js";
import type { SupplierRiskProfile } from "./risk.js";
import type { Scorecard } from "./scorecard.js";
import type { Supplier } from "./supplier.js";

/**
 * Award eligibility: the one question procurement actually asks — "can I give
 * this supplier this work today?" — answered from the facts each aggregate
 * owns.
 *
 * The rule set is a pure function so it can run identically in the HTTP
 * endpoint, in a batch panel review and in tests. It distinguishes **blockers**
 * (award is not allowed) from **warnings** (award is allowed, but somebody
 * should know), and every issue carries a stable code plus a human sentence,
 * because "not eligible" without a reason is useless to a buyer.
 */

export type EligibilityCode =
  | "supplier_not_active"
  | "category_not_assigned"
  | "category_not_approved"
  | "category_restricted"
  | "no_operational_site"
  | "qualification_missing"
  | "qualification_expired"
  | "qualification_conditional"
  | "certification_missing"
  | "certification_expired"
  | "certification_expiring"
  | "hold_active"
  | "risk_tier_critical"
  | "rating_probation"
  | "rating_watch"
  | "no_active_contract"
  | "not_payable"
  | "contract_expiring";

export interface EligibilityIssue {
  readonly code: EligibilityCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface EligibilityAssessment {
  readonly supplierId: Ulid;
  readonly supplierCode: string;
  readonly categoryId?: Ulid;
  readonly asOf: DateOnly;
  readonly eligible: boolean;
  readonly blockers: readonly EligibilityIssue[];
  readonly warnings: readonly EligibilityIssue[];
  /** Contract that would govern the award, when one is in force. */
  readonly governingContractId?: Ulid;
}

export interface EligibilityInput {
  readonly asOf: DateOnly;
  readonly supplier: Supplier;
  readonly categoryId?: Ulid;
  readonly policy?: CategoryPolicy;
  readonly qualifications: readonly Qualification[];
  readonly certifications: readonly Certification[];
  readonly riskProfile?: SupplierRiskProfile;
  readonly contracts: readonly Contract[];
  readonly latestScorecard?: Scorecard;
  /** Days before certificate expiry that should surface as a warning. */
  readonly expiryWarningDays?: number;
}

export function assessEligibility(input: EligibilityInput): EligibilityAssessment {
  const blockers: EligibilityIssue[] = [];
  const warnings: EligibilityIssue[] = [];
  const { supplier, asOf, categoryId, policy } = input;

  if (supplier.status !== "active") {
    blockers.push({
      code: "supplier_not_active",
      message: `Supplier ${supplier.code} is ${supplier.status}`,
      detail: { status: supplier.status },
    });
  }

  if (supplier.operationalSites().length === 0) {
    blockers.push({
      code: "no_operational_site",
      message: `Supplier ${supplier.code} has no active site that can deliver`,
    });
  }

  if (categoryId) {
    const assignment = supplier.categoryAssignment(categoryId);
    if (!assignment) {
      blockers.push({
        code: "category_not_assigned",
        message: `Supplier ${supplier.code} is not on the panel for this category`,
        detail: { categoryId },
      });
    } else if (assignment.status === "restricted") {
      blockers.push({
        code: "category_restricted",
        message: `Supplier ${supplier.code} is restricted in ${assignment.categoryCode}: ${assignment.restrictedReason ?? "no reason recorded"}`,
        detail: { categoryId, reason: assignment.restrictedReason },
      });
    } else if (assignment.status !== "approved") {
      blockers.push({
        code: "category_not_approved",
        message: `Supplier ${supplier.code} is only ${assignment.status} in ${assignment.categoryCode}`,
        detail: { categoryId, status: assignment.status },
      });
    }
  }

  // --- qualification -------------------------------------------------------

  if (policy?.requiresQualification) {
    const relevant = input.qualifications.filter(
      (qualification) => qualification.categoryId === undefined || qualification.categoryId === categoryId,
    );
    const valid = relevant.filter((qualification) => qualification.isValidOn(asOf));
    if (valid.length === 0) {
      const lapsed = relevant.filter((qualification) => qualification.status === "expired");
      blockers.push(
        lapsed.length > 0
          ? {
              code: "qualification_expired",
              message: `Supplier ${supplier.code}'s qualification for ${policy.path} lapsed on ${lapsed[0]?.validUntil ?? "an unknown date"}`,
              detail: { qualificationId: lapsed[0]?.id, validUntil: lapsed[0]?.validUntil },
            }
          : {
              code: "qualification_missing",
              message: `Category ${policy.path} requires a passed qualification`,
              detail: { categoryId },
            },
      );
    } else if (valid.every((qualification) => qualification.outcome === "conditional")) {
      warnings.push({
        code: "qualification_conditional",
        message: `Supplier ${supplier.code} is only conditionally qualified for ${policy.path}`,
        detail: {
          qualificationId: valid[0]?.id,
          conditions: valid[0]?.conditions,
          validUntil: valid[0]?.validUntil,
        },
      });
    }
  }

  // --- certifications ------------------------------------------------------

  const warningDays = input.expiryWarningDays ?? 60;
  const required: readonly CertificationType[] = policy?.requiredCertifications ?? [];
  for (const type of required) {
    const held = input.certifications.filter((certification) => certification.type === type);
    const effective = held.filter(
      (certification) => certification.status === "valid" && certification.isEffectiveOn(asOf),
    );
    if (effective.length === 0) {
      blockers.push(
        held.length === 0
          ? {
              code: "certification_missing",
              message: `Category ${policy?.path ?? "policy"} requires a ${type} certificate`,
              detail: { type },
            }
          : {
              code: "certification_expired",
              message: `The supplier's ${type} certificate is not currently valid`,
              detail: { type, status: held[0]?.status, expiresOn: held[0]?.expiresOn },
            },
      );
      continue;
    }
    const soonest = effective.reduce((earliest, certification) =>
      certification.daysToExpiry(asOf) < earliest.daysToExpiry(asOf) ? certification : earliest,
    );
    if (soonest.daysToExpiry(asOf) <= warningDays) {
      warnings.push({
        code: "certification_expiring",
        message: `The ${type} certificate expires on ${soonest.expiresOn} (${soonest.daysToExpiry(asOf)} days)`,
        detail: { type, expiresOn: soonest.expiresOn, daysToExpiry: soonest.daysToExpiry(asOf) },
      });
    }
  }

  // --- holds and risk ------------------------------------------------------

  const profile = input.riskProfile;
  if (profile) {
    for (const hold of profile.blockingHolds("sourcing", categoryId ? { categoryId } : {})) {
      blockers.push({
        code: "hold_active",
        message: `A ${hold.type} hold (${hold.reasonCode}) is active on ${supplier.code}`,
        detail: { holdId: hold.id, reasonCode: hold.reasonCode, scope: hold.scope },
      });
    }
    if (profile.tier === "critical") {
      warnings.push({
        code: "risk_tier_critical",
        message: `Supplier ${supplier.code} is rated critical risk (score ${profile.score})`,
        detail: { score: profile.score, openFlags: profile.openFlags().length },
      });
    }
  }

  // --- performance ---------------------------------------------------------

  const scorecard = input.latestScorecard;
  if (scorecard?.rating === "probation") {
    blockers.push({
      code: "rating_probation",
      message: `Supplier ${supplier.code} is on performance probation after ${scorecard.periodCode}`,
      detail: { periodCode: scorecard.periodCode, score: scorecard.score },
    });
  } else if (scorecard?.rating === "watch") {
    warnings.push({
      code: "rating_watch",
      message: `Supplier ${supplier.code} is on the watch list after ${scorecard.periodCode}`,
      detail: { periodCode: scorecard.periodCode, score: scorecard.score },
    });
  }

  // --- commercial cover ----------------------------------------------------

  const governing = input.contracts
    .filter((contract) => contract.isEffectiveOn(asOf))
    .filter((contract) => (categoryId ? contract.coversCategory(categoryId) : true))
    .sort((a, b) => (a.effectiveTo ?? "9999-12-31").localeCompare(b.effectiveTo ?? "9999-12-31"))[0];

  if (!governing) {
    warnings.push({
      code: "no_active_contract",
      message: `No active contract covers this award; it would be a spot purchase`,
      detail: { categoryId },
    });
  } else {
    const remaining = governing.daysToExpiry(asOf);
    if (remaining !== undefined && remaining <= 60) {
      warnings.push({
        code: "contract_expiring",
        message: `Contract ${governing.number} expires in ${remaining} days`,
        detail: { contractId: governing.id, effectiveTo: governing.effectiveTo },
      });
    }
  }

  if (!supplier.isPayable()) {
    warnings.push({
      code: "not_payable",
      message: `Supplier ${supplier.code} has no verified primary bank account; invoices cannot be paid`,
    });
  }

  return {
    supplierId: supplier.id,
    supplierCode: supplier.code,
    categoryId,
    asOf,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    governingContractId: governing?.id,
  };
}

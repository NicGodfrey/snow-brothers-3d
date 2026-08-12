import { DomainError } from "@enterprise-suite/shared-kernel";

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export class ValidationError extends DomainError {
  constructor(message: string, issues: readonly ValidationIssue[] = []) {
    super(message, "VALIDATION", 400, { issues });
    this.name = "ValidationError";
  }

  static single(field: string, message: string): ValidationError {
    return new ValidationError(`${field}: ${message}`, [{ field, message }]);
  }
}

/** The aggregate exists but the command is illegal in its current state. */
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_STATE", 422, details);
    this.name = "InvalidStateError";
  }
}

/**
 * One person may not both request and approve the same thing (fund requests,
 * claims, contract counter-signature).
 */
export class SegregationOfDutiesError extends DomainError {
  constructor(message: string) {
    super(message, "SEGREGATION_OF_DUTIES", 422);
    this.name = "SegregationOfDutiesError";
  }
}

/** A tier change was requested that the partner does not qualify for. */
export class TierEligibilityError extends DomainError {
  constructor(
    tierCode: string,
    readonly gaps: readonly { requirement: string; required: string; actual: string }[],
  ) {
    super(`Partner does not qualify for tier "${tierCode}"`, "TIER_INELIGIBLE", 422, { tierCode, gaps });
    this.name = "TierEligibilityError";
  }
}

/** Not enough uncommitted MDF money behind the request. */
export class BudgetExhaustedError extends DomainError {
  constructor(scope: string, requestedMinor: number, availableMinor: number, currency: string) {
    super(
      `${scope} has ${availableMinor} ${currency} available, ${requestedMinor} requested`,
      "MDF_BUDGET_EXHAUSTED",
      422,
      { scope, requestedMinor, availableMinor, currency },
    );
    this.name = "BudgetExhaustedError";
  }
}

/** Claims must land inside the post-activity window defined by the program. */
export class ClaimWindowError extends DomainError {
  constructor(deadline: string, at: string) {
    super(`Claim window closed on ${deadline} (attempted ${at})`, "MDF_CLAIM_WINDOW_CLOSED", 422, {
      deadline,
      at,
    });
    this.name = "ClaimWindowError";
  }
}

/** A certification was requested before its course/exam prerequisites were met. */
export class CertificationRequirementsError extends DomainError {
  constructor(certificationCode: string, readonly missing: readonly string[]) {
    super(
      `Certification ${certificationCode} requires ${missing.join(", ")}`,
      "CERTIFICATION_REQUIREMENTS_NOT_MET",
      422,
      { certificationCode, missing },
    );
    this.name = "CertificationRequirementsError";
  }
}

/** Portal entitlement check failed: policy unmet or an explicit deny is in force. */
export class EntitlementDeniedError extends DomainError {
  constructor(entitlementCode: string, readonly reasons: readonly string[]) {
    super(
      `Entitlement "${entitlementCode}" denied: ${reasons.join("; ")}`,
      "ENTITLEMENT_DENIED",
      403,
      { entitlementCode, reasons },
    );
    this.name = "EntitlementDeniedError";
  }
}

/** Two money values in different currencies met in one calculation. */
export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string) {
    super(`Currency mismatch: expected ${expected}, got ${actual}`, "CURRENCY_MISMATCH", 422, {
      expected,
      actual,
    });
    this.name = "CurrencyMismatchError";
  }
}

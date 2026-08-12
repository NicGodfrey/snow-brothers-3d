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

  static fromIssues(message: string, issues: readonly ValidationIssue[]): ValidationError {
    return new ValidationError(`${message} (${issues.length} issue(s))`, issues);
  }
}

/** The aggregate exists but its current state forbids the requested command. */
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_STATE", 422, details);
    this.name = "InvalidStateError";
  }
}

/**
 * A channel-program rule was broken: partner not authorized for a territory or
 * product line, discount beyond the tier band, protection extended past the
 * tier's cap. Distinct from ValidationError — the request was well formed, the
 * program says no.
 */
export class PolicyViolationError extends DomainError {
  constructor(message: string, readonly policy: string, details?: unknown) {
    super(message, "POLICY_VIOLATION", 422, { policy, ...(details as object | undefined) });
    this.name = "PolicyViolationError";
  }
}

/**
 * A deal registration collides with protected territory held by someone else.
 * Carries the findings so the partner portal can explain *why* without a second
 * round-trip.
 */
export class DealConflictError extends DomainError {
  constructor(message: string, readonly findings: readonly unknown[]) {
    super(message, "DEAL_CONFLICT", 409, { findings });
    this.name = "DealConflictError";
  }
}

/** Money arithmetic across currencies without an FX rate is always a bug here. */
export class CurrencyMismatchError extends DomainError {
  constructor(expected: string, actual: string, context: string) {
    super(
      `Currency mismatch in ${context}: expected ${expected}, got ${actual}`,
      "CURRENCY_MISMATCH",
      422,
      { expected, actual, context },
    );
    this.name = "CurrencyMismatchError";
  }
}

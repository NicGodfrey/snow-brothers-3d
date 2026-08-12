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

/** Raised when an operation is not permitted in the aggregate's current state. */
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_STATE", 422, details);
    this.name = "InvalidStateError";
  }
}

/**
 * Raised when an active compliance hold blocks a commercial action
 * (sourcing, PO issue, payment). Carries the hold ids so callers can render
 * "who to chase" without a second round-trip.
 */
export class ComplianceBlockedError extends DomainError {
  constructor(
    message: string,
    readonly holdIds: readonly string[],
    details?: unknown,
  ) {
    super(message, "COMPLIANCE_BLOCKED", 409, { holdIds, ...(details ?? {}) });
    this.name = "ComplianceBlockedError";
  }
}

/** Raised when the acting user's roles do not cover a restricted transition. */
export class RoleRequiredError extends DomainError {
  constructor(action: string, roles: readonly string[]) {
    super(`${action} requires one of the roles [${roles.join(", ")}]`, "ROLE_REQUIRED", 403, {
      requiredRoles: roles,
    });
    this.name = "RoleRequiredError";
  }
}

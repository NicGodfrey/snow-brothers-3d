import { DomainError } from "@enterprise-suite/shared-kernel";

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

/** Boundary/invariant violation: the caller sent something malformed. */
export class ValidationError extends DomainError {
  constructor(message: string, readonly issues: readonly ValidationIssue[] = []) {
    super(message, "VALIDATION", 422, { issues });
    this.name = "ValidationError";
  }

  static single(field: string, message: string): ValidationError {
    return new ValidationError(`${field} ${message}`, [{ field, message }]);
  }
}

/** The aggregate is in a state that forbids the requested transition. */
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_STATE", 409, details);
    this.name = "InvalidStateError";
  }

  static transition(aggregate: string, action: string, status: string, expected?: readonly string[]): InvalidStateError {
    const suffix = expected?.length ? ` (expected ${expected.join(" or ")})` : "";
    return new InvalidStateError(
      `Cannot ${action} ${aggregate} in status ${status}${suffix}`,
      { aggregate, action, status, expected },
    );
  }
}

/** A quantity/price/date breached a configured tolerance band. */
export class ToleranceExceededError extends DomainError {
  constructor(
    message: string,
    readonly toleranceCode: string,
    details?: unknown,
  ) {
    super(message, "TOLERANCE_EXCEEDED", 409, { toleranceCode, ...(details ?? {}) });
    this.name = "ToleranceExceededError";
  }
}

/** The supplier cannot be transacted with (blocked, inactive, uncategorised). */
export class SupplierNotOrderableError extends DomainError {
  constructor(supplierId: string, reason: string) {
    super(`Supplier ${supplierId} is not orderable: ${reason}`, "SUPPLIER_NOT_ORDERABLE", 409, {
      supplierId,
      reason,
    });
    this.name = "SupplierNotOrderableError";
  }
}

/** No approval policy matched, or the approver is not entitled to decide. */
export class ApprovalError extends DomainError {
  constructor(message: string, code = "APPROVAL_REJECTED", status = 409, details?: unknown) {
    super(message, code, status, details);
    this.name = "ApprovalError";
  }
}

/** A blanket agreement cap (value, quantity or per-release limit) was hit. */
export class AgreementLimitError extends DomainError {
  constructor(message: string, readonly limitCode: string, details?: unknown) {
    super(message, "AGREEMENT_LIMIT", 409, { limitCode, ...(details ?? {}) });
    this.name = "AgreementLimitError";
  }
}

/** The acting user's roles do not cover a restricted transition. */
export class RoleRequiredError extends DomainError {
  constructor(action: string, roles: readonly string[]) {
    super(`${action} requires one of the roles [${roles.join(", ")}]`, "ROLE_REQUIRED", 403, {
      requiredRoles: roles,
    });
    this.name = "RoleRequiredError";
  }
}

/** Guard helper that keeps aggregate code free of repetitive `if` blocks. */
export function invariant(condition: unknown, field: string, message: string): asserts condition {
  if (!condition) throw ValidationError.single(field, message);
}

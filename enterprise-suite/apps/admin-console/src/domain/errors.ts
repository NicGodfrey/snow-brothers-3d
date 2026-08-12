import { DomainError } from "@enterprise-suite/shared-kernel";

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

export class ValidationError extends DomainError {
  constructor(message: string, readonly issues: readonly ValidationIssue[] = []) {
    super(message, "VALIDATION", 400, issues.length > 0 ? issues : undefined);
    this.name = "ValidationError";
  }

  static single(field: string, message: string): ValidationError {
    return new ValidationError(`Invalid ${field}: ${message}`, [{ field, message }]);
  }

  static from(issues: readonly ValidationIssue[]): ValidationError {
    return new ValidationError(
      `Validation failed for ${issues.map((i) => i.field).join(", ")}`,
      issues,
    );
  }
}

/** A command that is legal in general but not from the current state. */
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_STATE", 422, details);
    this.name = "InvalidStateError";
  }
}

export class QuotaExceededError extends DomainError {
  constructor(readonly resource: string, readonly limit: number, readonly current: number) {
    super(
      `Tenant quota for ${resource} exhausted (${current}/${limit})`,
      "QUOTA_EXCEEDED",
      409,
      { resource, limit, current },
    );
    this.name = "QuotaExceededError";
  }
}

/** System-owned records (built-in roles, locked reference sets) refuse edits. */
export class ImmutableRecordError extends DomainError {
  constructor(kind: string, id: string) {
    super(`${kind} ${id} is system managed and cannot be modified`, "IMMUTABLE", 409, {
      kind,
      id,
    });
    this.name = "ImmutableRecordError";
  }
}

export class DuplicateError extends DomainError {
  constructor(kind: string, field: string, value: string) {
    super(`${kind} with ${field} "${value}" already exists`, "CONFLICT", 409, {
      kind,
      field,
      value,
    });
    this.name = "DuplicateError";
  }
}

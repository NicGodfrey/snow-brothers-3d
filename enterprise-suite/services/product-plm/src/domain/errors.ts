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

/** Raised when a BOM structure references itself, directly or transitively. */
export class BomCycleError extends DomainError {
  constructor(readonly path: readonly string[]) {
    super(`BOM cycle detected: ${path.join(" -> ")}`, "BOM_CYCLE", 422, { path });
    this.name = "BomCycleError";
  }
}

export class UomError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "UOM_ERROR", 400, details);
    this.name = "UomError";
  }
}

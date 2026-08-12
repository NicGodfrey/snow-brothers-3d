export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "CONFLICT", 409, details);
    this.name = "ConflictError";
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export interface FieldError {
  readonly path: string;
  readonly message: string;
}

export class ValidationError extends DomainError {
  constructor(readonly fieldErrors: readonly FieldError[]) {
    super("Validation failed", "VALIDATION_FAILED", 422, fieldErrors);
    this.name = "ValidationError";
  }
}

export class InvalidTransitionError extends ConflictError {
  constructor(aggregate: string, from: string, to: string) {
    super(`Invalid ${aggregate} transition: ${from} -> ${to}`, { aggregate, from, to });
    this.name = "InvalidTransitionError";
  }
}

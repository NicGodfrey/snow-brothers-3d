/**
 * Reporting-specific error types. All extend the shared-kernel DomainError
 * so the HTTP router maps them to a status without knowing our vocabulary.
 */
import { DomainError } from "@enterprise-suite/shared-kernel";

/** A metric/cube/dimension definition is internally inconsistent. */
export class DefinitionError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_DEFINITION", 422, details);
    this.name = "DefinitionError";
  }
}

/** A cube query references something that does not exist or is malformed. */
export class QueryError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_QUERY", 400, details);
    this.name = "QueryError";
  }
}

/** A metric expression failed to tokenize/parse. */
export class ExpressionError extends DomainError {
  constructor(message: string, readonly position?: number) {
    super(message, "INVALID_EXPRESSION", 422, position === undefined ? undefined : { position });
    this.name = "ExpressionError";
  }
}

/** A fact could not be derived from an inbound event DTO. */
export class IngestError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INGEST_REJECTED", 422, details);
    this.name = "IngestError";
  }
}

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

/** Raised when an operation is not permitted in the record's current state. */
export class InvalidStateError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "INVALID_STATE", 422, details);
    this.name = "InvalidStateError";
  }
}

/** Unknown / cross-dimension unit conversion. */
export class UomError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "UOM_ERROR", 400, details);
    this.name = "UomError";
  }
}

/** Unknown currency, wrong minor-unit scale, or a mismatched currency pair. */
export class CurrencyError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "CURRENCY_ERROR", 400, details);
    this.name = "CurrencyError";
  }
}

/** No usable rate for a pair on the requested date. */
export class FxRateUnavailableError extends DomainError {
  constructor(
    readonly base: string,
    readonly quote: string,
    readonly asOf: string,
    readonly rateType: string,
  ) {
    super(
      `No ${rateType} FX rate for ${base}/${quote} as of ${asOf}`,
      "FX_RATE_UNAVAILABLE",
      422,
      { base, quote, asOf, rateType },
    );
    this.name = "FxRateUnavailableError";
  }
}

/** Address failed country-specific structural validation. */
export class AddressValidationError extends DomainError {
  constructor(message: string, issues: readonly ValidationIssue[]) {
    super(message, "ADDRESS_INVALID", 400, { issues });
    this.name = "AddressValidationError";
  }
}

/** A code list lookup missed, or an entry was not effective on the given date. */
export class CodeListError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "CODE_LIST_ERROR", 422, details);
    this.name = "CodeListError";
  }
}

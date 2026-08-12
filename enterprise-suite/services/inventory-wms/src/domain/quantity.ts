import { DomainError } from "@enterprise-suite/shared-kernel";

/**
 * Quantities are integers in the SKU's base unit of measure. Fractional
 * inventory (e.g. kilograms) must be modeled by choosing a small-enough base
 * unit (grams), mirroring the money-in-minor-units rule of the suite.
 */
export const DEFAULT_UOM = "EA";

const UOM_PATTERN = /^[A-Z0-9]{1,8}$/;

export function normalizeUom(uom?: string | null): string {
  const value = (uom ?? DEFAULT_UOM).trim().toUpperCase();
  if (!UOM_PATTERN.test(value)) {
    throw new DomainError(`Invalid unit of measure: ${uom}`, "INVALID_UOM", 400);
  }
  return value;
}

export function assertPositiveQuantity(value: number, field = "quantity"): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError(
      `${field} must be a positive integer, got ${value}`,
      "INVALID_QUANTITY",
      400,
    );
  }
}

export function assertNonNegativeQuantity(value: number, field = "quantity"): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new DomainError(
      `${field} must be a non-negative integer, got ${value}`,
      "INVALID_QUANTITY",
      400,
    );
  }
}

/** Signed integer check for adjustment deltas (zero is rejected: a no-op adjustment is a bug). */
export function assertAdjustmentDelta(value: number, field = "deltaQty"): void {
  if (!Number.isInteger(value) || value === 0) {
    throw new DomainError(
      `${field} must be a non-zero integer, got ${value}`,
      "INVALID_QUANTITY",
      400,
    );
  }
}

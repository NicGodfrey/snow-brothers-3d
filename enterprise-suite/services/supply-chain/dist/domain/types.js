import { brand } from "@enterprise-suite/shared-kernel";
import { DomainError } from "@enterprise-suite/shared-kernel";
export function locationCode(value) {
    const v = value.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{0,31}$/.test(v)) {
        throw new DomainError(`Invalid location code: ${value}`, "VALIDATION");
    }
    return brand(v);
}
export function supplierId(value) {
    const v = value.trim();
    if (v.length === 0 || v.length > 64) {
        throw new DomainError(`Invalid supplier id: ${value}`, "VALIDATION");
    }
    return brand(v);
}
/**
 * Quantities in this domain are plain numbers with at most 3 decimal places
 * (e.g. kilograms). All arithmetic rounds through {@link roundQty} to keep
 * floating point noise out of comparisons and persisted values.
 */
export function roundQty(value) {
    return Math.round(value * 1000) / 1000;
}
export function assertQty(name, value, opts) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`${name} must be a finite number`, "VALIDATION");
    }
    if (value < 0)
        throw new DomainError(`${name} must not be negative`, "VALIDATION");
    if (value === 0 && opts?.allowZero === false) {
        throw new DomainError(`${name} must be greater than zero`, "VALIDATION");
    }
    return roundQty(value);
}
export function assertIntInRange(name, value, min, max) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        throw new DomainError(`${name} must be an integer between ${min} and ${max}`, "VALIDATION");
    }
    return value;
}
export const UNITS_OF_MEASURE = ["EA", "KG", "L", "M", "BOX"];
export function assertUom(value) {
    if (typeof value !== "string" || !UNITS_OF_MEASURE.includes(value)) {
        throw new DomainError(`Unit of measure must be one of ${UNITS_OF_MEASURE.join(", ")}`, "VALIDATION");
    }
    return value;
}
//# sourceMappingURL=types.js.map
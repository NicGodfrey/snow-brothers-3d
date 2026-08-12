import { DomainError } from "@enterprise-suite/shared-kernel";
import { locationCode } from "../domain/types.js";
/** Minimal hand-rolled body/query validation for the HTTP boundary. */
export function asObject(body, name = "body") {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new DomainError(`${name} must be a JSON object`, "VALIDATION");
    }
    return body;
}
export function requireString(obj, key) {
    const value = obj[key];
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new DomainError(`${key} must be a non-empty string`, "VALIDATION");
    }
    return value.trim();
}
export function optionalString(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string")
        throw new DomainError(`${key} must be a string`, "VALIDATION");
    return value.trim() || undefined;
}
export function requireNumber(obj, key) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`${key} must be a finite number`, "VALIDATION");
    }
    return value;
}
export function optionalNumber(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`${key} must be a finite number`, "VALIDATION");
    }
    return value;
}
export function optionalBoolean(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "boolean")
        throw new DomainError(`${key} must be a boolean`, "VALIDATION");
    return value;
}
export function requireArray(obj, key) {
    const value = obj[key];
    if (!Array.isArray(value))
        throw new DomainError(`${key} must be an array`, "VALIDATION");
    return value;
}
export function optionalArray(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value))
        throw new DomainError(`${key} must be an array`, "VALIDATION");
    return value;
}
export function requireLocation(source, key = "location") {
    const value = source[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new DomainError(`${key} is required`, "VALIDATION");
    }
    return locationCode(value);
}
export function queryInt(query, key, fallback, min, max) {
    const raw = query[key];
    if (raw === undefined)
        return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
        throw new DomainError(`${key} must be an integer between ${min} and ${max}`, "VALIDATION");
    }
    return value;
}
export function parseWeekEntries(raw) {
    return raw.map((entry, i) => {
        const obj = asObject(entry, `entries[${i}]`);
        return { weekStart: requireString(obj, "weekStart"), qty: requireNumber(obj, "qty") };
    });
}
//# sourceMappingURL=validate.js.map
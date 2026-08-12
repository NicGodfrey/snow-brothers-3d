/**
 * Tiny request-body validation helpers. Every failure throws a
 * DomainError with code VALIDATION and the offending field name, which the
 * router maps to HTTP 400.
 */
import { brand, DomainError } from "@enterprise-suite/shared-kernel";
export function asObject(body, name = "body") {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new DomainError(`${name} must be a JSON object`, "VALIDATION");
    }
    return body;
}
export function requireString(obj, key) {
    const value = obj[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new DomainError(`'${key}' is required and must be a non-empty string`, "VALIDATION");
    }
    return value;
}
export function optionalString(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string") {
        throw new DomainError(`'${key}' must be a string`, "VALIDATION");
    }
    return value;
}
export function requireNumber(obj, key) {
    const value = obj[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`'${key}' is required and must be a finite number`, "VALIDATION");
    }
    return value;
}
export function optionalNumber(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`'${key}' must be a finite number`, "VALIDATION");
    }
    return value;
}
export function optionalBoolean(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "boolean") {
        throw new DomainError(`'${key}' must be a boolean`, "VALIDATION");
    }
    return value;
}
export function requireBoolean(obj, key) {
    const value = obj[key];
    if (typeof value !== "boolean") {
        throw new DomainError(`'${key}' is required and must be a boolean`, "VALIDATION");
    }
    return value;
}
export function requireEnum(obj, key, values) {
    const value = requireString(obj, key);
    if (!values.includes(value)) {
        throw new DomainError(`'${key}' must be one of: ${values.join(", ")}`, "VALIDATION");
    }
    return value;
}
export function optionalEnum(obj, key, values) {
    const value = optionalString(obj, key);
    if (value === undefined)
        return undefined;
    if (!values.includes(value)) {
        throw new DomainError(`'${key}' must be one of: ${values.join(", ")}`, "VALIDATION");
    }
    return value;
}
export function requireNumberArray(obj, key) {
    const value = obj[key];
    if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
        throw new DomainError(`'${key}' must be a non-empty array of numbers`, "VALIDATION");
    }
    return value;
}
export function optionalObjectArray(obj, key) {
    const value = obj[key];
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value) || value.some((v) => typeof v !== "object" || v === null)) {
        throw new DomainError(`'${key}' must be an array of objects`, "VALIDATION");
    }
    return value;
}
export function requireObjectArray(obj, key) {
    const value = optionalObjectArray(obj, key);
    if (!value || value.length === 0) {
        throw new DomainError(`'${key}' must be a non-empty array of objects`, "VALIDATION");
    }
    return value;
}
export function requireIsoDate(obj, key) {
    const value = requireString(obj, key);
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new DomainError(`'${key}' must be an ISO-8601 date-time`, "VALIDATION");
    }
    return brand(parsed.toISOString());
}
export function optionalUlid(obj, key) {
    const value = optionalString(obj, key);
    return value === undefined ? undefined : brand(value);
}
export function requireUlid(obj, key) {
    return brand(requireString(obj, key));
}
export function ulidParam(params, key) {
    const value = params[key];
    if (!value)
        throw new DomainError(`Missing path parameter '${key}'`, "VALIDATION");
    return brand(value);
}
//# sourceMappingURL=validation.js.map
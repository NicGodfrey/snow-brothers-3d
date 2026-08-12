import { DomainError } from "@enterprise-suite/shared-kernel";
/**
 * Small body-validation helpers for HTTP handlers. They throw 400s with
 * field-level messages before anything reaches the domain layer.
 */
export function asRecord(body, what = "request body") {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new DomainError(`Expected ${what} to be a JSON object`, "VALIDATION", 400);
    }
    return body;
}
export function requireString(obj, field) {
    const value = obj[field];
    if (typeof value !== "string" || value.trim() === "") {
        throw new DomainError(`Field '${field}' must be a non-empty string`, "VALIDATION", 400);
    }
    return value;
}
export function optionalString(obj, field) {
    const value = obj[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string") {
        throw new DomainError(`Field '${field}' must be a string`, "VALIDATION", 400);
    }
    return value;
}
export function requireNumber(obj, field) {
    const value = obj[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`Field '${field}' must be a finite number`, "VALIDATION", 400);
    }
    return value;
}
export function optionalNumber(obj, field) {
    const value = obj[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new DomainError(`Field '${field}' must be a finite number`, "VALIDATION", 400);
    }
    return value;
}
export function optionalBoolean(obj, field) {
    const value = obj[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "boolean") {
        throw new DomainError(`Field '${field}' must be a boolean`, "VALIDATION", 400);
    }
    return value;
}
export function requireArray(obj, field) {
    const value = obj[field];
    if (!Array.isArray(value)) {
        throw new DomainError(`Field '${field}' must be an array`, "VALIDATION", 400);
    }
    return value;
}
export function optionalArray(obj, field) {
    const value = obj[field];
    if (value === undefined || value === null)
        return undefined;
    if (!Array.isArray(value)) {
        throw new DomainError(`Field '${field}' must be an array`, "VALIDATION", 400);
    }
    return value;
}
export function requireOneOf(obj, field, allowed) {
    const value = requireString(obj, field);
    if (!allowed.includes(value)) {
        throw new DomainError(`Field '${field}' must be one of [${allowed.join(", ")}]`, "VALIDATION", 400);
    }
    return value;
}
export function optionalOneOf(obj, field, allowed) {
    const value = optionalString(obj, field);
    if (value === undefined)
        return undefined;
    if (!allowed.includes(value)) {
        throw new DomainError(`Field '${field}' must be one of [${allowed.join(", ")}]`, "VALIDATION", 400);
    }
    return value;
}
//# sourceMappingURL=validate.js.map
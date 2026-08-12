import { brand, DomainError, ForbiddenError, money, } from "@enterprise-suite/shared-kernel";
import { isoDate, timeOfDay } from "../domain/common.js";
/** Boundary validation helpers: every HTTP body field passes through these. */
function fail(field, expectation) {
    throw new DomainError(`Field "${field}" ${expectation}`, "VALIDATION", 422, { field });
}
export function asRecord(body) {
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
        throw new DomainError("Request body must be a JSON object", "VALIDATION", 422);
    }
    return body;
}
export function str(body, field) {
    const value = body[field];
    if (typeof value !== "string" || value.trim() === "")
        fail(field, "must be a non-empty string");
    return value;
}
export function optStr(body, field) {
    const value = body[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "string")
        fail(field, "must be a string");
    return value;
}
export function num(body, field) {
    const value = body[field];
    if (typeof value !== "number" || !Number.isFinite(value))
        fail(field, "must be a finite number");
    return value;
}
export function optNum(body, field) {
    const value = body[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "number" || !Number.isFinite(value))
        fail(field, "must be a finite number");
    return value;
}
export function int(body, field) {
    const value = num(body, field);
    if (!Number.isInteger(value))
        fail(field, "must be an integer");
    return value;
}
export function optInt(body, field) {
    const value = optNum(body, field);
    if (value === undefined)
        return undefined;
    if (!Number.isInteger(value))
        fail(field, "must be an integer");
    return value;
}
export function bool(body, field, fallback) {
    const value = body[field];
    if (value === undefined || value === null) {
        if (fallback !== undefined)
            return fallback;
        fail(field, "must be a boolean");
    }
    if (typeof value !== "boolean")
        fail(field, "must be a boolean");
    return value;
}
export function optBool(body, field) {
    const value = body[field];
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== "boolean")
        fail(field, "must be a boolean");
    return value;
}
export function dateField(body, field) {
    return isoDate(str(body, field));
}
export function optDateField(body, field) {
    const value = optStr(body, field);
    return value === undefined ? undefined : isoDate(value);
}
export function timeField(body, field) {
    return timeOfDay(str(body, field));
}
export function optTimeField(body, field) {
    const value = optStr(body, field);
    return value === undefined ? undefined : timeOfDay(value);
}
/** Expects `{ amountMinor: int, currency: "XXX" }`. */
export function moneyField(body, field) {
    const value = body[field];
    if (typeof value !== "object" || value === null) {
        fail(field, 'must be an object like { "amountMinor": 100000, "currency": "USD" }');
    }
    const record = value;
    const amountMinor = record.amountMinor;
    const currency = record.currency;
    if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor)) {
        fail(`${field}.amountMinor`, "must be an integer (minor units)");
    }
    if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
        fail(`${field}.currency`, "must be a 3-letter ISO currency code");
    }
    return money(amountMinor, currency);
}
export function optMoneyField(body, field) {
    if (body[field] === undefined || body[field] === null)
        return undefined;
    return moneyField(body, field);
}
export function ulidParam(params, name) {
    const value = params[name];
    if (!value)
        fail(name, "path parameter is required");
    return brand(value);
}
export function optUlid(body, field) {
    const value = optStr(body, field);
    return value === undefined ? undefined : brand(value);
}
export function ulidField(body, field) {
    return brand(str(body, field));
}
export function queryInt(query, name, fallback) {
    const raw = query.get(name);
    if (raw === null) {
        if (fallback !== undefined)
            return fallback;
        throw new DomainError(`Query parameter "${name}" is required`, "VALIDATION", 422);
    }
    const value = Number(raw);
    if (!Number.isInteger(value)) {
        throw new DomainError(`Query parameter "${name}" must be an integer`, "VALIDATION", 422);
    }
    return value;
}
export function enumField(body, field, allowed) {
    const value = str(body, field);
    if (!allowed.includes(value)) {
        fail(field, `must be one of: ${allowed.join(", ")}`);
    }
    return value;
}
export function optEnumField(body, field, allowed) {
    const value = optStr(body, field);
    if (value === undefined)
        return undefined;
    if (!allowed.includes(value)) {
        fail(field, `must be one of: ${allowed.join(", ")}`);
    }
    return value;
}
/** The acting user (from `x-user-id`) as a Ulid for audit fields. */
export function actorId(ctx) {
    return brand(ctx.userId);
}
/** Role gate for privileged endpoints; roles come from the `x-roles` header. */
export function requireRole(ctx, ...anyOf) {
    const roles = ctx.roles.map((r) => r);
    if (!anyOf.some((role) => roles.includes(role))) {
        throw new ForbiddenError(`Requires one of roles: ${anyOf.join(", ")}`);
    }
}
//# sourceMappingURL=parse.js.map
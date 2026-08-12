import type { AddressInput } from "../domain/address.js";
import { ValidationError, type ValidationIssue } from "../domain/errors.js";

/**
 * Body-shape helpers. Each reads one field off an unknown body and throws a
 * ValidationError carrying per-field issues when the shape is wrong, which
 * keeps route handlers declarative without pulling in a schema library.
 */

export function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw ValidationError.single(field, "must be a non-empty string");
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw ValidationError.single(field, "must be a string");
  return value;
}

export function requiredNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw ValidationError.single(field, "must be a finite number");
  }
  return value;
}

export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw ValidationError.single(field, "must be a finite number");
  }
  return value;
}

export function requiredInteger(body: Record<string, unknown>, field: string): number {
  const value = requiredNumber(body, field);
  if (!Number.isInteger(value)) throw ValidationError.single(field, "must be a whole number");
  return value;
}

export function optionalInteger(body: Record<string, unknown>, field: string): number | undefined {
  const value = optionalNumber(body, field);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) throw ValidationError.single(field, "must be a whole number");
  return value;
}

export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw ValidationError.single(field, "must be a boolean");
  return value;
}

export function requiredEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = body[field];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw ValidationError.single(field, `must be one of [${allowed.join(", ")}]`);
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return requiredEnum(body, field, allowed);
}

export function requiredEnumArray<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw ValidationError.single(field, `must be a non-empty array of [${allowed.join(", ")}]`);
  }
  const issues: ValidationIssue[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== "string" || !(allowed as readonly string[]).includes(entry)) {
      issues.push({ field: `${field}[${index}]`, message: `must be one of [${allowed.join(", ")}]` });
    }
  });
  if (issues.length > 0) throw new ValidationError(`Invalid ${field}`, issues);
  return value as T[];
}

export function optionalEnumArray<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T[] | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return requiredEnumArray(body, field, allowed);
}

export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw ValidationError.single(field, "must be an array of strings");
  }
  return value as string[];
}

export function optionalStringMap(
  body: Record<string, unknown>,
  field: string,
): Record<string, string> | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, "must be an object of string values");
  }
  const issues: ValidationIssue[] = [];
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string") {
      issues.push({ field: `${field}.${key}`, message: "must be a string" });
    } else {
      out[key] = entry;
    }
  }
  if (issues.length > 0) throw new ValidationError(`Invalid ${field}`, issues);
  return out;
}

/** Code list entry attributes: string | number | boolean. */
export function optionalAttributeMap(
  body: Record<string, unknown>,
  field: string,
): Record<string, string | number | boolean> | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, "must be an object");
  }
  const issues: ValidationIssue[] = [];
  const out: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "string" && typeof entry !== "number" && typeof entry !== "boolean") {
      issues.push({ field: `${field}.${key}`, message: "must be string | number | boolean" });
    } else {
      out[key] = entry;
    }
  }
  if (issues.length > 0) throw new ValidationError(`Invalid ${field}`, issues);
  return out;
}

/** Reads a nested address object, which every party endpoint accepts. */
export function requiredAddress(body: Record<string, unknown>, field = "address"): AddressInput {
  const raw = body[field];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw ValidationError.single(field, "must be an address object");
  }
  const address = raw as Record<string, unknown>;
  let coordinates: { latitude: number; longitude: number } | undefined;
  if (address["coordinates"] !== undefined && address["coordinates"] !== null) {
    const point = address["coordinates"];
    if (typeof point !== "object" || Array.isArray(point)) {
      throw ValidationError.single(`${field}.coordinates`, "must be { latitude, longitude }");
    }
    const record = point as Record<string, unknown>;
    coordinates = {
      latitude: requiredNumber(record, "latitude"),
      longitude: requiredNumber(record, "longitude"),
    };
  }
  return {
    organization: optionalString(address, "organization"),
    attention: optionalString(address, "attention"),
    line1: requiredString(address, "line1"),
    line2: optionalString(address, "line2"),
    line3: optionalString(address, "line3"),
    city: requiredString(address, "city"),
    region: optionalString(address, "region"),
    postalCode: optionalString(address, "postalCode"),
    countryCode: requiredString(address, "countryCode"),
    coordinates,
  };
}

export function optionalAddress(
  body: Record<string, unknown>,
  field = "address",
): AddressInput | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return requiredAddress(body, field);
}

export function pageFromQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page !== null ? Number(page) : undefined,
    pageSize: pageSize !== null ? Number(pageSize) : undefined,
  };
}

export function requiredQuery(query: URLSearchParams, name: string): string {
  const value = query.get(name);
  if (value === null || value.trim().length === 0) {
    throw ValidationError.single(name, "query parameter is required");
  }
  return value;
}

export function numberQuery(query: URLSearchParams, name: string): number {
  const value = Number(requiredQuery(query, name));
  if (!Number.isFinite(value)) throw ValidationError.single(name, "must be a number");
  return value;
}

import { ValidationError, type ValidationIssue } from "../domain/errors.js";

/**
 * Tiny body-shape helpers. Each reads one field off an unknown body and
 * throws a ValidationError with per-field issues when the shape is wrong,
 * keeping route handlers declarative without pulling in a schema library.
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

export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw ValidationError.single(field, "must be an array of strings");
  }
  return value as string[];
}

export function requiredStringMap(
  body: Record<string, unknown>,
  field: string,
): Record<string, string> {
  const value = body[field];
  const issues: ValidationIssue[] = [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, "must be an object of string values");
  }
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

/** Attribute values: string | number | boolean | string[]. */
export function optionalAttributeMap(
  body: Record<string, unknown>,
  field: string,
): Record<string, string | number | boolean | string[]> | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, "must be an object");
  }
  const issues: ValidationIssue[] = [];
  const out: Record<string, string | number | boolean | string[]> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const okScalar =
      typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean";
    const okArray = Array.isArray(entry) && entry.every((v) => typeof v === "string");
    if (!okScalar && !okArray) {
      issues.push({ field: `${field}.${key}`, message: "must be string | number | boolean | string[]" });
    } else {
      out[key] = entry as string | number | boolean | string[];
    }
  }
  if (issues.length > 0) throw new ValidationError(`Invalid ${field}`, issues);
  return out;
}

export function pageFromQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page !== null ? Number(page) : undefined,
    pageSize: pageSize !== null ? Number(pageSize) : undefined,
  };
}

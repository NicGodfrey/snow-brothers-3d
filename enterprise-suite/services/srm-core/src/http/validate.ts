import type { Ulid, UserId } from "@enterprise-suite/shared-kernel";
import { dateOnly, type DateOnly } from "../domain/dates.js";
import { ValidationError, type ValidationIssue } from "../domain/errors.js";

/**
 * Body-shape helpers. Each reads one field off an unknown body and throws a
 * ValidationError carrying per-field issues, which keeps route handlers
 * declarative without pulling in a schema library. Date fields go through the
 * domain's `DateOnly` parser so a malformed "2026-02-30" is rejected at the
 * edge rather than inside an aggregate.
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

/** Distinguishes "absent" from an explicit `null`, which clears a field. */
export function nullableString(body: Record<string, unknown>, field: string): string | null | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw ValidationError.single(field, "must be a string or null");
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

export function requiredDate(body: Record<string, unknown>, field: string): DateOnly {
  return dateOnly(requiredString(body, field), field);
}

export function optionalDate(body: Record<string, unknown>, field: string): DateOnly | undefined {
  const value = optionalString(body, field);
  return value === undefined ? undefined : dateOnly(value, field);
}

export function requiredId(body: Record<string, unknown>, field: string): Ulid {
  return requiredString(body, field) as Ulid;
}

export function optionalId(body: Record<string, unknown>, field: string): Ulid | undefined {
  return optionalString(body, field) as Ulid | undefined;
}

/** Owner/assignee references are user ids, not aggregate ids. */
export function optionalUserId(body: Record<string, unknown>, field: string): UserId | undefined {
  return optionalString(body, field) as UserId | undefined;
}

export function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw ValidationError.single(field, "must be an array of strings");
  }
  return value as string[];
}

export function optionalIdArray(body: Record<string, unknown>, field: string): Ulid[] | undefined {
  return optionalStringArray(body, field) as Ulid[] | undefined;
}

export function optionalObject(body: Record<string, unknown>, field: string): Record<string, unknown> | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function requiredObject(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = optionalObject(body, field);
  if (value === undefined) throw ValidationError.single(field, "is required");
  return value;
}

export function requiredArray(body: Record<string, unknown>, field: string): readonly unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) throw ValidationError.single(field, "must be an array");
  return value;
}

export function optionalArray(body: Record<string, unknown>, field: string): readonly unknown[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw ValidationError.single(field, "must be an array");
  return value;
}

/** Numeric map used for qualification section weights. */
export function optionalNumberMap(
  body: Record<string, unknown>,
  field: string,
): Record<string, number> | undefined {
  const value = optionalObject(body, field);
  if (value === undefined) return undefined;
  const issues: ValidationIssue[] = [];
  const out: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) {
      issues.push({ field: `${field}.${key}`, message: "must be a finite number" });
    } else {
      out[key] = entry;
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

export function queryEnum<T extends string>(
  query: URLSearchParams,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = query.get(field);
  if (value === null) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw ValidationError.single(field, `must be one of [${allowed.join(", ")}]`);
  }
  return value as T;
}

export function queryId(query: URLSearchParams, field: string): Ulid | undefined {
  return (query.get(field) as Ulid | null) ?? undefined;
}

export function queryDate(query: URLSearchParams, field: string): DateOnly | undefined {
  const value = query.get(field);
  return value === null ? undefined : dateOnly(value, field);
}

export function queryNumber(query: URLSearchParams, field: string): number | undefined {
  const value = query.get(field);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw ValidationError.single(field, "must be a number");
  return parsed;
}

export function queryBoolean(query: URLSearchParams, field: string): boolean | undefined {
  const value = query.get(field);
  if (value === null) return undefined;
  if (value !== "true" && value !== "false") throw ValidationError.single(field, "must be true or false");
  return value === "true";
}

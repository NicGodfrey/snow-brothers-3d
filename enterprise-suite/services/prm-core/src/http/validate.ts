import type { IsoDateTime, Money, Ulid } from "@enterprise-suite/shared-kernel";
import { parseIso } from "../domain/dates.js";
import { ValidationError } from "../domain/errors.js";
import { parseMoney } from "../domain/money.js";

/**
 * Body-shape helpers. Each reads one field off an unknown body and throws a
 * ValidationError carrying per-field issues, which keeps route handlers
 * declarative without pulling in a schema library.
 */

export function asRecord(body: unknown): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function optionalRecord(body: unknown): Record<string, unknown> {
  return body === undefined ? {} : asRecord(body);
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

export function requiredId(body: Record<string, unknown>, field: string): Ulid {
  return requiredString(body, field) as Ulid;
}

export function optionalId(body: Record<string, unknown>, field: string): Ulid | undefined {
  return optionalString(body, field) as Ulid | undefined;
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
  return requiredNumber(body, field);
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
    throw ValidationError.single(field, "must be a non-empty array");
  }
  const issues = value.filter((entry) => typeof entry !== "string" || !(allowed as readonly string[]).includes(entry));
  if (issues.length > 0) {
    throw ValidationError.single(field, `entries must be one of [${allowed.join(", ")}]`);
  }
  return value as T[];
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

export function requiredStringArray(body: Record<string, unknown>, field: string): string[] {
  const value = optionalStringArray(body, field);
  if (!value || value.length === 0) throw ValidationError.single(field, "must be a non-empty array of strings");
  return value;
}

export function requiredMoney(body: Record<string, unknown>, field: string): Money {
  if (body[field] === undefined) throw ValidationError.single(field, "is required");
  return parseMoney(body[field], field);
}

export function optionalMoney(body: Record<string, unknown>, field: string): Money | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return parseMoney(body[field], field);
}

export function requiredDate(body: Record<string, unknown>, field: string): IsoDateTime {
  return parseIso(requiredString(body, field), field);
}

export function optionalDate(body: Record<string, unknown>, field: string): IsoDateTime | undefined {
  const value = optionalString(body, field);
  return value === undefined ? undefined : parseIso(value, field);
}

export function pageFromQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page !== null ? Number(page) : undefined,
    pageSize: pageSize !== null ? Number(pageSize) : undefined,
  };
}

/** Reads a query parameter constrained to a known set of values. */
export function enumFromQuery<T extends string>(
  query: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw ValidationError.single(key, `must be one of [${allowed.join(", ")}]`);
  }
  return value as T;
}

export function idFromQuery(query: URLSearchParams, key: string): Ulid | undefined {
  const value = query.get(key);
  return value === null ? undefined : (value as Ulid);
}

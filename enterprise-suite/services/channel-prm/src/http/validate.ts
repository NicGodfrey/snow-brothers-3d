import { money, type IsoDateTime, type Money, type Ulid } from "@enterprise-suite/shared-kernel";
import { ValidationError, type ValidationIssue } from "../domain/errors.js";
import type { ExternalRef } from "../domain/channel-quote.js";

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

export function requiredStringArray(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "string")) {
    throw ValidationError.single(field, "must be a non-empty array of strings");
  }
  return value as string[];
}

export function optionalStringArray(body: Record<string, unknown>, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw ValidationError.single(field, "must be an array of strings");
  }
  return value as string[];
}

export function requiredIso(body: Record<string, unknown>, field: string): IsoDateTime {
  const value = requiredString(body, field);
  if (Number.isNaN(Date.parse(value))) throw ValidationError.single(field, "must be an ISO date-time");
  return value as IsoDateTime;
}

export function optionalIso(body: Record<string, unknown>, field: string): IsoDateTime | undefined {
  const value = optionalString(body, field);
  if (value === undefined) return undefined;
  if (Number.isNaN(Date.parse(value))) throw ValidationError.single(field, "must be an ISO date-time");
  return value as IsoDateTime;
}

export function requiredId(body: Record<string, unknown>, field: string): Ulid {
  return requiredString(body, field) as Ulid;
}

export function optionalId(body: Record<string, unknown>, field: string): Ulid | undefined {
  return optionalString(body, field) as Ulid | undefined;
}

/**
 * Money arrives as `{ "amountMinor": 125000, "currency": "USD" }`. Minor units
 * only — accepting a decimal here is how rounding bugs get into a channel
 * program.
 */
export function requiredMoney(body: Record<string, unknown>, field: string): Money {
  const value = body[field];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, 'must be an object like { "amountMinor": 125000, "currency": "USD" }');
  }
  const record = value as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const amount = record["amountMinor"];
  const currency = record["currency"];
  if (typeof amount !== "number" || !Number.isInteger(amount)) {
    issues.push({ field: `${field}.amountMinor`, message: "must be an integer number of minor units" });
  }
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) {
    issues.push({ field: `${field}.currency`, message: "must be a 3-letter ISO currency code" });
  }
  if (issues.length > 0) throw ValidationError.fromIssues(`Invalid ${field}`, issues);
  return money(amount as number, currency as string);
}

export function optionalMoney(body: Record<string, unknown>, field: string): Money | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return requiredMoney(body, field);
}

export function optionalExternalRef(body: Record<string, unknown>, field: string): ExternalRef | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, 'must be an object like { "system": "sales-erp", "id": "so_1" }');
  }
  const record = value as Record<string, unknown>;
  return {
    system: optionalString(record, "system") ?? "sales-erp",
    id: requiredString(record, "id"),
    number: optionalString(record, "number"),
  };
}

export function requiredObject(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = body[field];
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw ValidationError.single(field, "must be an object");
  }
  return value as Record<string, unknown>;
}

export function pageFromQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page !== null ? Number(page) : undefined,
    pageSize: pageSize !== null ? Number(pageSize) : undefined,
  };
}

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

export function numberFromQuery(query: URLSearchParams, key: string): number | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw ValidationError.single(key, "must be a number");
  return parsed;
}

export function isoFromQuery(query: URLSearchParams, key: string): IsoDateTime | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  if (Number.isNaN(Date.parse(value))) throw ValidationError.single(key, "must be an ISO date-time");
  return value as IsoDateTime;
}

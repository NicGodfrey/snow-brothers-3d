import {
  brand,
  DomainError,
  ForbiddenError,
  money,
  type Money,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { isoDate, type IsoDate } from "../domain/common.js";

/** Boundary validation helpers: every HTTP body field passes through these. */

function fail(field: string, expectation: string): never {
  throw new DomainError(`Field "${field}" ${expectation}`, "VALIDATION", 422, { field });
}

export function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("Request body must be a JSON object", "VALIDATION", 422);
  }
  return body as Record<string, unknown>;
}

/** Optional body: absent bodies become `{}` so action endpoints stay terse. */
export function asOptionalRecord(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  return asRecord(body);
}

export function arrayOf<T>(
  body: Record<string, unknown>,
  field: string,
  map: (record: Record<string, unknown>, index: number) => T,
): T[] {
  const value = body[field];
  if (!Array.isArray(value)) fail(field, "must be an array");
  return value.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      fail(`${field}[${index}]`, "must be a JSON object");
    }
    return map(entry as Record<string, unknown>, index);
  });
}

export function optArrayOf<T>(
  body: Record<string, unknown>,
  field: string,
  map: (record: Record<string, unknown>, index: number) => T,
): T[] | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return arrayOf(body, field, map);
}

export function str(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") fail(field, "must be a non-empty string");
  return value;
}

export function optStr(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(field, "must be a string");
  return value;
}

export function strList(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    fail(field, "must be an array of strings");
  }
  return value as string[];
}

export function optStrList(body: Record<string, unknown>, field: string): string[] | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return strList(body, field);
}

export function num(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field, "must be a finite number");
  return value;
}

export function optNum(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(field, "must be a finite number");
  return value;
}

export function int(body: Record<string, unknown>, field: string): number {
  const value = num(body, field);
  if (!Number.isInteger(value)) fail(field, "must be an integer");
  return value;
}

export function optInt(body: Record<string, unknown>, field: string): number | undefined {
  const value = optNum(body, field);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value)) fail(field, "must be an integer");
  return value;
}

export function intList(body: Record<string, unknown>, field: string): number[] {
  const value = body[field];
  if (!Array.isArray(value) || value.some((entry) => !Number.isInteger(entry))) {
    fail(field, "must be an array of integers");
  }
  return value as number[];
}

export function bool(body: Record<string, unknown>, field: string, fallback?: boolean): boolean {
  const value = body[field];
  if (value === undefined || value === null) {
    if (fallback !== undefined) return fallback;
    fail(field, "must be a boolean");
  }
  if (typeof value !== "boolean") fail(field, "must be a boolean");
  return value;
}

export function optBool(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") fail(field, "must be a boolean");
  return value;
}

export function dateField(body: Record<string, unknown>, field: string): IsoDate {
  return isoDate(str(body, field));
}

export function optDateField(body: Record<string, unknown>, field: string): IsoDate | undefined {
  const value = optStr(body, field);
  return value === undefined ? undefined : isoDate(value);
}

/** Expects `{ amountMinor: int, currency: "XXX" }`. */
export function moneyField(body: Record<string, unknown>, field: string): Money {
  const value = body[field];
  if (typeof value !== "object" || value === null) {
    fail(field, 'must be an object like { "amountMinor": 100000, "currency": "USD" }');
  }
  const record = value as Record<string, unknown>;
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

export function optMoneyField(body: Record<string, unknown>, field: string): Money | undefined {
  if (body[field] === undefined || body[field] === null) return undefined;
  return moneyField(body, field);
}

/**
 * Line payloads carry `unitPriceMinor` alongside the document currency rather
 * than repeating `{ amountMinor, currency }` on every line.
 */
export function minorPrice(
  body: Record<string, unknown>,
  field: string,
  currency: string,
): Money {
  return money(int(body, field), currency);
}

export function optMinorPrice(
  body: Record<string, unknown>,
  field: string,
  currency: string,
): Money | undefined {
  const value = optInt(body, field);
  return value === undefined ? undefined : money(value, currency);
}

export function ulidParam(params: Readonly<Record<string, string>>, name: string): Ulid {
  const value = params[name];
  if (!value) fail(name, "path parameter is required");
  return brand<string, "Ulid">(value);
}

/** Line numbers appear in paths (`/lines/3`) and must be positive integers. */
export function intParam(params: Readonly<Record<string, string>>, name: string): number {
  const raw = params[name];
  const value = Number(raw);
  if (!Number.isInteger(value)) fail(name, "path parameter must be an integer");
  return value;
}

export function ulidField(body: Record<string, unknown>, field: string): Ulid {
  return brand<string, "Ulid">(str(body, field));
}

export function optUlid(body: Record<string, unknown>, field: string): Ulid | undefined {
  const value = optStr(body, field);
  return value === undefined ? undefined : brand<string, "Ulid">(value);
}

export function optUlidList(body: Record<string, unknown>, field: string): Ulid[] | undefined {
  const values = optStrList(body, field);
  return values?.map((value) => brand<string, "Ulid">(value));
}

export function enumField<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = str(body, field);
  if (!allowed.includes(value as T)) fail(field, `must be one of: ${allowed.join(", ")}`);
  return value as T;
}

export function optEnumField<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = optStr(body, field);
  if (value === undefined) return undefined;
  if (!allowed.includes(value as T)) fail(field, `must be one of: ${allowed.join(", ")}`);
  return value as T;
}

// -- query string ------------------------------------------------------------

export function queryStr(query: URLSearchParams, name: string): string | undefined {
  return query.get(name) ?? undefined;
}

export function queryUlid(query: URLSearchParams, name: string): Ulid | undefined {
  const value = query.get(name);
  return value ? brand<string, "Ulid">(value) : undefined;
}

export function queryBool(query: URLSearchParams, name: string): boolean | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  return value !== "false" && value !== "0";
}

export function queryInt(query: URLSearchParams, name: string, fallback?: number): number {
  const raw = query.get(name);
  if (raw === null) {
    if (fallback !== undefined) return fallback;
    throw new DomainError(`Query parameter "${name}" is required`, "VALIDATION", 422);
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new DomainError(`Query parameter "${name}" must be an integer`, "VALIDATION", 422);
  }
  return value;
}

export function queryEnum<T extends string>(
  query: URLSearchParams,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = query.get(name);
  if (value === null) return undefined;
  if (!allowed.includes(value as T)) {
    throw new DomainError(
      `Query parameter "${name}" must be one of: ${allowed.join(", ")}`,
      "VALIDATION",
      422,
      { parameter: name },
    );
  }
  return value as T;
}

export function queryDate(query: URLSearchParams, name: string): IsoDate | undefined {
  const value = query.get(name);
  return value === null ? undefined : isoDate(value);
}

export function requiredQueryDate(query: URLSearchParams, name: string): IsoDate {
  const value = queryDate(query, name);
  if (!value) {
    throw new DomainError(`Query parameter "${name}" is required`, "VALIDATION", 422, {
      parameter: name,
    });
  }
  return value;
}

/** Currency for analytics endpoints, defaulting so dashboards work bare. */
export function queryCurrency(query: URLSearchParams, fallback = "USD"): string {
  return query.get("currency") ?? fallback;
}

// -- identity ----------------------------------------------------------------

/** The acting user (from `x-user-id`) as a Ulid for audit fields. */
export function actorId(ctx: TenantContext): Ulid {
  return brand<string, "Ulid">(ctx.userId as string);
}

export function actorRoles(ctx: TenantContext): string[] {
  return ctx.roles.map((role) => role as string);
}

/** Role gate for privileged endpoints; roles come from the `x-roles` header. */
export function requireRole(ctx: TenantContext, ...anyOf: string[]): void {
  const roles = actorRoles(ctx);
  if (!anyOf.some((role) => roles.includes(role))) {
    throw new ForbiddenError(`Requires one of roles: ${anyOf.join(", ")}`);
  }
}

/**
 * Request-body validation helpers. Every failure throws a DomainError with
 * code VALIDATION, which the router maps to HTTP 400.
 */
import { brand, DomainError, type IsoDateTime, type Ulid } from "@enterprise-suite/shared-kernel";

export function asObject(body: unknown, name = "body"): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError(`${name} must be a JSON object`, "VALIDATION");
  }
  return body as Record<string, unknown>;
}

export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError(`'${key}' is required and must be a non-empty string`, "VALIDATION");
  }
  return value;
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DomainError(`'${key}' must be a string`, "VALIDATION");
  }
  return value;
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`'${key}' is required and must be a finite number`, "VALIDATION");
  }
  return value;
}

export function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`'${key}' must be a finite number`, "VALIDATION");
  }
  return value;
}

export function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError(`'${key}' must be a boolean`, "VALIDATION");
  }
  return value;
}

export function requireEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  const value = requireString(obj, key);
  if (!values.includes(value as T)) {
    throw new DomainError(`'${key}' must be one of: ${values.join(", ")}`, "VALIDATION");
  }
  return value as T;
}

export function optionalEnum<T extends string>(
  obj: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = optionalString(obj, key);
  if (value === undefined) return undefined;
  if (!values.includes(value as T)) {
    throw new DomainError(`'${key}' must be one of: ${values.join(", ")}`, "VALIDATION");
  }
  return value as T;
}

export function requireStringArray(obj: Record<string, unknown>, key: string): string[] {
  const value = obj[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new DomainError(`'${key}' must be a non-empty array of strings`, "VALIDATION");
  }
  return value as string[];
}

export function optionalStringArray(
  obj: Record<string, unknown>,
  key: string,
): string[] | undefined {
  if (obj[key] === undefined || obj[key] === null) return undefined;
  return requireStringArray(obj, key);
}

export function optionalStringRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  const record = asObject(value, key);
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") {
      throw new DomainError(`'${key}.${entryKey}' must be a string`, "VALIDATION");
    }
  }
  return record as Record<string, string>;
}

export function optionalRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  return asObject(value, key);
}

export function requireRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = optionalRecord(obj, key);
  if (!value) throw new DomainError(`'${key}' is required and must be an object`, "VALIDATION");
  return value;
}

export function requireObjectArray(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] {
  const value = obj[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "object" || item === null || Array.isArray(item))
  ) {
    throw new DomainError(`'${key}' must be a non-empty array of objects`, "VALIDATION");
  }
  return value as Record<string, unknown>[];
}

export function requireIsoDate(obj: Record<string, unknown>, key: string): IsoDateTime {
  const value = requireString(obj, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError(`'${key}' must be an ISO-8601 date-time`, "VALIDATION");
  }
  return brand<string, "IsoDateTime">(parsed.toISOString());
}

export function requireUlid(obj: Record<string, unknown>, key: string): Ulid {
  return brand<string, "Ulid">(requireString(obj, key));
}

export function optionalUlid(obj: Record<string, unknown>, key: string): Ulid | undefined {
  const value = optionalString(obj, key);
  return value === undefined ? undefined : brand<string, "Ulid">(value);
}

export function ulidParam(params: Record<string, string>, key: string): Ulid {
  const value = params[key];
  if (!value) throw new DomainError(`Missing path parameter '${key}'`, "VALIDATION");
  return brand<string, "Ulid">(value);
}

export function queryEnum<T extends string>(
  query: URLSearchParams,
  key: string,
  values: readonly T[],
): T | undefined {
  const value = query.get(key);
  if (value === null) return undefined;
  if (!values.includes(value as T)) {
    throw new DomainError(`query '${key}' must be one of: ${values.join(", ")}`, "VALIDATION");
  }
  return value as T;
}

export function queryUlid(query: URLSearchParams, key: string): Ulid | undefined {
  const value = query.get(key);
  return value === null ? undefined : brand<string, "Ulid">(value);
}

export function queryNumber(query: URLSearchParams, key: string, fallback: number): number {
  const value = query.get(key);
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new DomainError(`query '${key}' must be a number`, "VALIDATION");
  }
  return parsed;
}

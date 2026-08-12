/**
 * Tiny request-body validation helpers. Every failure throws a
 * DomainError with code VALIDATION and the offending field name, which the
 * router maps to HTTP 400.
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

export function requireBoolean(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new DomainError(`'${key}' is required and must be a boolean`, "VALIDATION");
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

export function requireNumberArray(obj: Record<string, unknown>, key: string): number[] {
  const value = obj[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== "number" || !Number.isFinite(v))) {
    throw new DomainError(`'${key}' must be a non-empty array of numbers`, "VALIDATION");
  }
  return value as number[];
}

export function optionalObjectArray(
  obj: Record<string, unknown>,
  key: string,
): Record<string, unknown>[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "object" || v === null)) {
    throw new DomainError(`'${key}' must be an array of objects`, "VALIDATION");
  }
  return value as Record<string, unknown>[];
}

export function requireObjectArray(obj: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = optionalObjectArray(obj, key);
  if (!value || value.length === 0) {
    throw new DomainError(`'${key}' must be a non-empty array of objects`, "VALIDATION");
  }
  return value;
}

export function requireIsoDate(obj: Record<string, unknown>, key: string): IsoDateTime {
  const value = requireString(obj, key);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError(`'${key}' must be an ISO-8601 date-time`, "VALIDATION");
  }
  return brand<string, "IsoDateTime">(parsed.toISOString());
}

export function ulidParam(params: Record<string, string>, key: string): Ulid {
  const value = params[key];
  if (!value) throw new DomainError(`Missing path parameter '${key}'`, "VALIDATION");
  return brand<string, "Ulid">(value);
}

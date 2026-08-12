import { DomainError, type IsoDateTime, type Ulid } from "@enterprise-suite/shared-kernel";

/**
 * Lightweight command validation used at the boundary (HTTP handlers and
 * service commands). Throws DomainError(400, "VALIDATION") with a field path
 * so clients get actionable errors without any external schema library.
 */

export function invalid(message: string, details?: unknown): never {
  throw new DomainError(message, "VALIDATION", 400, details);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function reqBody(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) invalid("Request body must be a JSON object");
  return value;
}

export function reqString(
  value: unknown,
  field: string,
  opts: { maxLength?: number; pattern?: RegExp } = {},
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${field} is required and must be a non-empty string`);
  }
  const trimmed = value.trim();
  const maxLength = opts.maxLength ?? 256;
  if (trimmed.length > maxLength) {
    invalid(`${field} must be at most ${maxLength} characters`);
  }
  if (opts.pattern && !opts.pattern.test(trimmed)) {
    invalid(`${field} does not match required format ${opts.pattern}`);
  }
  return trimmed;
}

export function optString(
  value: unknown,
  field: string,
  opts: { maxLength?: number; pattern?: RegExp } = {},
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return reqString(value, field, opts);
}

export function reqId(value: unknown, field: string): Ulid {
  return reqString(value, field, { maxLength: 64 }) as Ulid;
}

export function optId(value: unknown, field: string): Ulid | undefined {
  const parsed = optString(value, field, { maxLength: 64 });
  return parsed as Ulid | undefined;
}

export function reqInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    invalid(`${field} must be an integer`);
  }
  const n = value as number;
  if (opts.min !== undefined && n < opts.min) invalid(`${field} must be >= ${opts.min}`);
  if (opts.max !== undefined && n > opts.max) invalid(`${field} must be <= ${opts.max}`);
  return n;
}

export function optInt(
  value: unknown,
  field: string,
  opts: { min?: number; max?: number } = {},
): number | undefined {
  if (value === undefined || value === null) return undefined;
  return reqInt(value, field, opts);
}

export function reqEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    invalid(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return value as T;
}

export function optEnum<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T | undefined {
  if (value === undefined || value === null) return undefined;
  return reqEnum(value, field, allowed);
}

export function optBool(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") invalid(`${field} must be a boolean`);
  return value as boolean;
}

export function reqArray<T>(
  value: unknown,
  field: string,
  mapItem: (item: unknown, index: number) => T,
  opts: { minLength?: number; maxLength?: number } = {},
): T[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array`);
  const arr = value as unknown[];
  const minLength = opts.minLength ?? 1;
  const maxLength = opts.maxLength ?? 500;
  if (arr.length < minLength) invalid(`${field} must have at least ${minLength} item(s)`);
  if (arr.length > maxLength) invalid(`${field} must have at most ${maxLength} item(s)`);
  return arr.map((item, index) => mapItem(item, index));
}

export function optIsoDate(value: unknown, field: string): IsoDateTime | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    invalid(`${field} must be an ISO-8601 date-time string`);
  }
  return new Date(value as string).toISOString() as IsoDateTime;
}

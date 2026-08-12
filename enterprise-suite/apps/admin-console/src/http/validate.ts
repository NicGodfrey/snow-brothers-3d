import { ValidationError, type ValidationIssue } from "../domain/errors.js";

/**
 * Body-shape helpers. Each reads one field from an unknown body and throws a
 * `ValidationError` carrying per-field issues, so handlers stay declarative
 * without a schema library on the dependency list.
 */

export function asRecord(body: unknown, field = "body"): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw ValidationError.single(field, "must be a JSON object");
  }
  return body as Record<string, unknown>;
}

export function asArray(body: unknown, field = "body"): unknown[] {
  if (!Array.isArray(body)) throw ValidationError.single(field, "must be a JSON array");
  return body;
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

export function requiredBoolean(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];
  if (typeof value !== "boolean") throw ValidationError.single(field, "must be a boolean");
  return value;
}

export function optionalBoolean(
  body: Record<string, unknown>,
  field: string,
): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw ValidationError.single(field, "must be a boolean");
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
  if (issues.length > 0) throw ValidationError.from(issues);
  return out;
}

/** Flag values are booleans, strings or numbers; anything else is rejected. */
export function flagValue(
  body: Record<string, unknown>,
  field: string,
): boolean | string | number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw ValidationError.single(field, "must be a boolean, string or finite number");
}

export function pageFromQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page !== null ? Number(page) : undefined,
    pageSize: pageSize !== null ? Number(pageSize) : undefined,
  };
}

export function booleanFromQuery(query: URLSearchParams, field: string): boolean | undefined {
  const value = query.get(field);
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  throw ValidationError.single(field, 'must be "true" or "false"');
}

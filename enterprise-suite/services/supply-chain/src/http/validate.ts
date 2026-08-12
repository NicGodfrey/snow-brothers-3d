import { DomainError } from "@enterprise-suite/shared-kernel";
import { locationCode, type LocationCode } from "../domain/types.js";

/** Minimal hand-rolled body/query validation for the HTTP boundary. */

export function asObject(body: unknown, name = "body"): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError(`${name} must be a JSON object`, "VALIDATION");
  }
  return body as Record<string, unknown>;
}

export function requireString(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError(`${key} must be a non-empty string`, "VALIDATION");
  }
  return value.trim();
}

export function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new DomainError(`${key} must be a string`, "VALIDATION");
  return value.trim() || undefined;
}

export function requireNumber(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`${key} must be a finite number`, "VALIDATION");
  }
  return value;
}

export function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`${key} must be a finite number`, "VALIDATION");
  }
  return value;
}

export function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new DomainError(`${key} must be a boolean`, "VALIDATION");
  return value;
}

export function requireArray(obj: Record<string, unknown>, key: string): unknown[] {
  const value = obj[key];
  if (!Array.isArray(value)) throw new DomainError(`${key} must be an array`, "VALIDATION");
  return value;
}

export function optionalArray(obj: Record<string, unknown>, key: string): unknown[] | undefined {
  const value = obj[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new DomainError(`${key} must be an array`, "VALIDATION");
  return value;
}

export function requireLocation(source: Record<string, unknown> | Record<string, string>, key = "location"): LocationCode {
  const value = (source as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError(`${key} is required`, "VALIDATION");
  }
  return locationCode(value);
}

export function queryInt(query: Record<string, string>, key: string, fallback: number, min: number, max: number): number {
  const raw = query[key];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new DomainError(`${key} must be an integer between ${min} and ${max}`, "VALIDATION");
  }
  return value;
}

export function parseWeekEntries(raw: unknown[]): { weekStart: string; qty: number }[] {
  return raw.map((entry, i) => {
    const obj = asObject(entry, `entries[${i}]`);
    return { weekStart: requireString(obj, "weekStart"), qty: requireNumber(obj, "qty") };
  });
}

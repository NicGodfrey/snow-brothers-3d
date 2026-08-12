import { DomainError } from "@enterprise-suite/shared-kernel";

/**
 * Small body-validation helpers for HTTP handlers. They throw 400s with
 * field-level messages before anything reaches the domain layer.
 */

export function asRecord(body: unknown, what = "request body"): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError(`Expected ${what} to be a JSON object`, "VALIDATION", 400);
  }
  return body as Record<string, unknown>;
}

export function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError(`Field '${field}' must be a non-empty string`, "VALIDATION", 400);
  }
  return value;
}

export function optionalString(obj: Record<string, unknown>, field: string): string | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DomainError(`Field '${field}' must be a string`, "VALIDATION", 400);
  }
  return value;
}

export function requireNumber(obj: Record<string, unknown>, field: string): number {
  const value = obj[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`Field '${field}' must be a finite number`, "VALIDATION", 400);
  }
  return value;
}

export function optionalNumber(obj: Record<string, unknown>, field: string): number | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`Field '${field}' must be a finite number`, "VALIDATION", 400);
  }
  return value;
}

export function optionalBoolean(obj: Record<string, unknown>, field: string): boolean | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError(`Field '${field}' must be a boolean`, "VALIDATION", 400);
  }
  return value;
}

export function requireArray(obj: Record<string, unknown>, field: string): unknown[] {
  const value = obj[field];
  if (!Array.isArray(value)) {
    throw new DomainError(`Field '${field}' must be an array`, "VALIDATION", 400);
  }
  return value;
}

export function optionalArray(obj: Record<string, unknown>, field: string): unknown[] | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new DomainError(`Field '${field}' must be an array`, "VALIDATION", 400);
  }
  return value;
}

export function requireOneOf<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const value = requireString(obj, field);
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DomainError(
      `Field '${field}' must be one of [${allowed.join(", ")}]`,
      "VALIDATION",
      400,
    );
  }
  return value as T;
}

export function optionalOneOf<T extends string>(
  obj: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T | undefined {
  const value = optionalString(obj, field);
  if (value === undefined) return undefined;
  if (!(allowed as readonly string[]).includes(value)) {
    throw new DomainError(
      `Field '${field}' must be one of [${allowed.join(", ")}]`,
      "VALIDATION",
      400,
    );
  }
  return value as T;
}

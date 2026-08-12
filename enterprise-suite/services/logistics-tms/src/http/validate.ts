import { DomainError, brand, type Ulid } from "@enterprise-suite/shared-kernel";

/** Brands a path parameter as an aggregate id. */
export function idParam(params: Readonly<Record<string, string>>, name: string): Ulid {
  const value = params[name];
  if (value === undefined || value.length === 0) {
    throw new DomainError(`Missing path parameter :${name}`, "VALIDATION");
  }
  return brand<string, "Ulid">(value);
}

/**
 * Small boundary validators for HTTP payloads. They guarantee the shape
 * the application layer expects; deeper business validation lives in the
 * domain. All failures are 400 VALIDATION errors with a field path.
 */

export function expectObject(body: unknown, label = "body"): Record<string, unknown> {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new DomainError(`${label} must be a JSON object`, "VALIDATION");
  }
  return body as Record<string, unknown>;
}

/** Required aggregate-id body field. */
export function reqId(obj: Record<string, unknown>, field: string): Ulid {
  return brand<string, "Ulid">(reqString(obj, field));
}

/** Optional aggregate-id body field. */
export function optId(obj: Record<string, unknown>, field: string): Ulid | undefined {
  const value = optString(obj, field);
  return value === undefined ? undefined : brand<string, "Ulid">(value);
}

export function reqString(
  obj: Record<string, unknown>,
  field: string,
  label = field,
): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new DomainError(`${label} is required and must be a non-empty string`, "VALIDATION");
  }
  return value;
}

export function optString(
  obj: Record<string, unknown>,
  field: string,
  label = field,
): string | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DomainError(`${label} must be a string`, "VALIDATION");
  }
  return value;
}

export function reqNumber(
  obj: Record<string, unknown>,
  field: string,
  label = field,
): number {
  const value = obj[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`${label} is required and must be a number`, "VALIDATION");
  }
  return value;
}

export function optNumber(
  obj: Record<string, unknown>,
  field: string,
  label = field,
): number | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DomainError(`${label} must be a number`, "VALIDATION");
  }
  return value;
}

export function optBoolean(obj: Record<string, unknown>, field: string): boolean | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError(`${field} must be a boolean`, "VALIDATION");
  }
  return value;
}

export function optArray(obj: Record<string, unknown>, field: string): unknown[] | undefined {
  const value = obj[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new DomainError(`${field} must be an array`, "VALIDATION");
  }
  return value;
}

export function reqArray(obj: Record<string, unknown>, field: string): unknown[] {
  const value = optArray(obj, field);
  if (value === undefined || value.length === 0) {
    throw new DomainError(`${field} is required and must be a non-empty array`, "VALIDATION");
  }
  return value;
}

export function optStringArray(
  obj: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = optArray(obj, field);
  if (value === undefined) return undefined;
  return value.map((item, i) => {
    if (typeof item !== "string") {
      throw new DomainError(`${field}[${i}] must be a string`, "VALIDATION");
    }
    return item;
  });
}

export function pageParams(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page !== null ? Number(page) : undefined,
    pageSize: pageSize !== null ? Number(pageSize) : undefined,
  };
}

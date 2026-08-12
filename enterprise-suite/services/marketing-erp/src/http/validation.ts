import { DomainError } from "@enterprise-suite/shared-kernel";

/**
 * Boundary validation for JSON request bodies. Deliberately minimal: the
 * domain enforces business invariants; these helpers only guarantee shape
 * and produce consistent 400s with field names.
 */

export function asRecord(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new DomainError("Request body must be a JSON object", "INVALID_BODY");
  }
  return body as Record<string, unknown>;
}

export function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError(`Field '${field}' must be a non-empty string`, "INVALID_FIELD", 400, {
      field,
    });
  }
  return value;
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DomainError(`Field '${field}' must be a string`, "INVALID_FIELD", 400, { field });
  }
  return value;
}

export function requireNumber(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new DomainError(`Field '${field}' must be a number`, "INVALID_FIELD", 400, { field });
  }
  return value;
}

export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new DomainError(`Field '${field}' must be a number`, "INVALID_FIELD", 400, { field });
  }
  return value;
}

export function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError(`Field '${field}' must be a boolean`, "INVALID_FIELD", 400, { field });
  }
  return value;
}

export function requireBoolean(body: Record<string, unknown>, field: string): boolean {
  const value = body[field];
  if (typeof value !== "boolean") {
    throw new DomainError(`Field '${field}' must be a boolean`, "INVALID_FIELD", 400, { field });
  }
  return value;
}

export function optionalStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
    throw new DomainError(`Field '${field}' must be an array of strings`, "INVALID_FIELD", 400, {
      field,
    });
  }
  return value as string[];
}

export function requireObject(
  body: Record<string, unknown>,
  field: string,
): Record<string, unknown> {
  const value = body[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DomainError(`Field '${field}' must be an object`, "INVALID_FIELD", 400, { field });
  }
  return value as Record<string, unknown>;
}

export function optionalObject(
  body: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  return requireObject(body, field);
}

export function optionalStringRecord(
  body: Record<string, unknown>,
  field: string,
): Record<string, string> | undefined {
  const raw = optionalObject(body, field);
  if (raw === undefined) return undefined;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      throw new DomainError(
        `Field '${field}.${key}' must be a string`,
        "INVALID_FIELD",
        400,
        { field: `${field}.${key}` },
      );
    }
  }
  return raw as Record<string, string>;
}

export function pageFromQuery(query: URLSearchParams): { page?: number; pageSize?: number } {
  const page = query.get("page");
  const pageSize = query.get("pageSize");
  return {
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
  };
}

/** Parses a UTM object out of a request body field. */
export function utmFromBody(
  body: Record<string, unknown>,
  field: string,
  required: boolean,
): { source: string; medium: string; campaign: string; term?: string; content?: string } | undefined {
  const raw = required ? requireObject(body, field) : optionalObject(body, field);
  if (raw === undefined) return undefined;
  return {
    source: requireString(raw, "source"),
    medium: requireString(raw, "medium"),
    campaign: requireString(raw, "campaign"),
    term: optionalString(raw, "term"),
    content: optionalString(raw, "content"),
  };
}

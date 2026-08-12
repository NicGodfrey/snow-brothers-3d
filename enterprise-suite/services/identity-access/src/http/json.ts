import type { IncomingMessage, ServerResponse } from "node:http";
import { DomainError } from "@enterprise-suite/shared-kernel";

const MAX_BODY_BYTES = 1_000_000;

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = chunk as Buffer;
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new DomainError("Request body too large", "PAYLOAD_TOO_LARGE", 413);
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (raw === "") return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new DomainError("Request body is not valid JSON", "INVALID_JSON", 400);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null, replacer);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, error: unknown): void {
  if (error instanceof DomainError) {
    sendJson(res, error.status, {
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  sendJson(res, 500, { error: { code: "INTERNAL", message } });
}

/** Aggregates expose `toJSON`; sets and maps would otherwise serialize as `{}`. */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Set) return [...value];
  if (value instanceof Map) return Object.fromEntries(value);
  return value;
}

export function requireString(body: unknown, field: string): string {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new DomainError(`Field "${field}" is required`, "VALIDATION", 422);
  }
  return value;
}

export function optionalString(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new DomainError(`Field "${field}" must be a string`, "VALIDATION", 422);
  }
  return value;
}

export function optionalNumber(body: unknown, field: string): number | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new DomainError(`Field "${field}" must be a number`, "VALIDATION", 422);
  }
  return value;
}

export function optionalBoolean(body: unknown, field: string): boolean | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new DomainError(`Field "${field}" must be a boolean`, "VALIDATION", 422);
  }
  return value;
}

export function optionalStringArray(body: unknown, field: string): readonly string[] | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DomainError(`Field "${field}" must be an array of strings`, "VALIDATION", 422);
  }
  return value as string[];
}

export function objectField(body: unknown, field: string): Record<string, unknown> | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new DomainError(`Field "${field}" must be an object`, "VALIDATION", 422);
  }
  return value as Record<string, unknown>;
}

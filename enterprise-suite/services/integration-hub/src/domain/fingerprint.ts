/**
 * Canonical serialization and hashing.
 *
 * Idempotency keys, inbox de-duplication and webhook signatures all need a
 * byte-stable rendering of a JSON value: two structurally equal payloads must
 * hash identically regardless of key order, and any real difference must
 * change the hash.
 */
import { createHash } from "node:crypto";
import { DomainError } from "@enterprise-suite/shared-kernel";

/**
 * JSON with object keys sorted recursively. `undefined` members are dropped
 * (as `JSON.stringify` does); cycles are rejected rather than silently cut.
 */
export function canonicalJson(value: unknown, seen: Set<object> = new Set()): string {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "number") {
    if (!Number.isFinite(value as number)) {
      throw new DomainError("Cannot canonicalize non-finite number", "VALIDATION");
    }
    return JSON.stringify(value);
  }
  if (type === "string" || type === "boolean") return JSON.stringify(value);
  if (type === "bigint") return JSON.stringify((value as bigint).toString());
  if (type === "undefined" || type === "function" || type === "symbol") return "null";

  const object = value as object;
  if (seen.has(object)) {
    throw new DomainError("Cannot canonicalize a cyclic structure", "VALIDATION");
  }
  seen.add(object);
  try {
    if (Array.isArray(object)) {
      return `[${object.map((item) => canonicalJson(item, seen)).join(",")}]`;
    }
    if (object instanceof Date) return JSON.stringify(object.toISOString());
    const entries = Object.entries(object as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && typeof v !== "function" && typeof v !== "symbol")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v, seen)}`).join(",")}}`;
  } finally {
    seen.delete(object);
  }
}

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Stable content hash of any JSON-ish value. */
export function fingerprint(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Short, log-friendly prefix of a fingerprint. */
export function shortFingerprint(value: unknown): string {
  return fingerprint(value).slice(0, 16);
}

import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../http/errors.js";

/** Claims shared by suite login issuers and HTTP edge consumers. */
export interface SuiteTokenClaims {
  readonly tenantId: string;
  readonly userId: string;
  readonly roles: readonly string[];
  /** Seconds since the Unix epoch. */
  readonly exp: number;
  /** Seconds since the Unix epoch. */
  readonly iat?: number;
  readonly sessionId?: string;
  readonly impersonatedBy?: string;
}

export interface VerifySuiteTokenOptions {
  readonly nowMs?: number;
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;

/**
 * Creates a compact HS256 JWT. `SUITE_AUTH_SECRET` is supplied by the caller so
 * this kernel never silently falls back to a deployable, well-known key.
 */
export function signSuiteToken(claims: SuiteTokenClaims, secret: string): string {
  assertSecret(secret);
  const normalized = validateClaims(claims);
  const payload = `${encode(HEADER)}.${encode(normalized)}`;
  return `${payload}.${signature(payload, secret)}`;
}

/** Verifies signature, algorithm, claim shape and expiry before returning claims. */
export function verifySuiteToken(
  token: string,
  secret: string,
  options: VerifySuiteTokenOptions = {},
): SuiteTokenClaims {
  assertSecret(secret);
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
    throw invalidToken("Malformed suite token");
  }

  const [encodedHeader, encodedClaims, suppliedSignature] = parts as [string, string, string];
  const header = decodeJson(encodedHeader);
  if (!isRecord(header) || header.alg !== HEADER.alg || header.typ !== HEADER.typ) {
    throw invalidToken("Unsupported suite token algorithm");
  }

  const expectedSignature = signature(`${encodedHeader}.${encodedClaims}`, secret);
  if (!safeEqual(suppliedSignature, expectedSignature)) {
    throw invalidToken("Bad suite token signature");
  }

  const claims = validateClaims(decodeJson(encodedClaims));
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  if (claims.exp <= nowSeconds) {
    throw new DomainError("Suite token expired", "TOKEN_EXPIRED", 401);
  }
  return claims;
}

function validateClaims(value: unknown): SuiteTokenClaims {
  if (!isRecord(value)) throw invalidToken("Suite token claims must be an object");

  const tenantId = nonEmptyString(value.tenantId);
  const userId = nonEmptyString(value.userId);
  const roleValues = Array.isArray(value.roles) ? value.roles : undefined;
  const roles = roleValues
    ? roleValues.map(nonEmptyString).filter((role): role is string => role !== undefined)
    : undefined;
  const exp = value.exp;
  const iat = value.iat;

  if (!tenantId || !userId) throw invalidToken("Suite token is missing tenantId/userId");
  if (!roles || roles.length !== roleValues?.length) {
    throw invalidToken("Suite token roles must be an array of non-empty strings");
  }
  if (!Number.isSafeInteger(exp) || (exp as number) <= 0) {
    throw invalidToken("Suite token exp must be a positive integer");
  }
  if (iat !== undefined && (!Number.isSafeInteger(iat) || (iat as number) < 0)) {
    throw invalidToken("Suite token iat must be a non-negative integer");
  }

  const sessionId = optionalString(value.sessionId);
  const impersonatedBy = optionalString(value.impersonatedBy);
  return {
    tenantId,
    userId,
    roles: [...new Set(roles)],
    exp: exp as number,
    ...(iat === undefined ? {} : { iat: iat as number }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(impersonatedBy === undefined ? {} : { impersonatedBy }),
  };
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    throw invalidToken("Suite token contains invalid JSON");
  }
}

function assertSecret(secret: string): void {
  if (secret.trim().length === 0) {
    throw new Error("SUITE_AUTH_SECRET must not be empty");
  }
}

function invalidToken(message: string): DomainError {
  return new DomainError(message, "INVALID_TOKEN", 401);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const parsed = nonEmptyString(value);
  if (!parsed) throw invalidToken("Optional suite token claims must be non-empty strings");
  return parsed;
}

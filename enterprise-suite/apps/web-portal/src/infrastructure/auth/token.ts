import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "@enterprise-suite/shared-kernel";

/**
 * Mock bearer tokens.
 *
 * JWS compact serialisation with HS256 — real enough that swapping in the
 * identity-access issuer is a configuration change, mock enough that the
 * portal can mint its own in development. Verification checks the signature
 * and the expiry; nothing else about it is production-grade.
 */

export interface TokenClaims {
  /** Subject: user id. */
  readonly sub: string;
  /** Active tenant. */
  readonly tid: string;
  readonly roles: readonly string[];
  readonly sid: string;
  /** Seconds since epoch. */
  readonly iat: number;
  readonly exp: number;
  readonly obo?: string;
}

const HEADER = { alg: "HS256", typ: "JWT" } as const;

export function signToken(claims: TokenClaims, secret: string): string {
  const payload = `${encode(HEADER)}.${encode(claims)}`;
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyToken(token: string, secret: string, nowMs: number): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new DomainError("Malformed token", "INVALID_TOKEN", 401);
  }
  const [header, body, signature] = parts as [string, string, string];
  const expected = sign(`${header}.${body}`, secret);
  if (!safeEqual(signature, expected)) {
    throw new DomainError("Bad token signature", "INVALID_TOKEN", 401);
  }
  const claims = decode<TokenClaims>(body);
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= nowMs) {
    throw new DomainError("Token expired", "TOKEN_EXPIRED", 401);
  }
  if (!claims.sub || !claims.tid) {
    throw new DomainError("Token is missing sub/tid", "INVALID_TOKEN", 401);
  }
  return claims;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decode<T>(value: string): T {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    throw new DomainError("Token payload is not JSON", "INVALID_TOKEN", 401);
  }
}

/**
 * Webhook payload signing.
 *
 * Signature header format (Stripe-style, versioned so the scheme can evolve):
 *
 *   x-es-signature: t=1754992800,v1=<hex hmac-sha256>
 *
 * The signed string is `${timestampSeconds}.${rawBody}`, so replaying a body
 * with a new timestamp does not validate. Verification accepts a set of
 * secrets, which is what makes zero-downtime secret rotation possible: during
 * the grace window both the new and the previous secret are accepted.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DomainError } from "@enterprise-suite/shared-kernel";

export const SIGNATURE_HEADER = "x-es-signature";
export const SIGNATURE_VERSION = "v1";
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignatureAlgorithm = "hmac-sha256";

export interface SignatureParts {
  readonly timestamp: number;
  readonly signatures: readonly string[];
}

export function generateSecret(bytes = 32): string {
  return `whsec_${randomBytes(bytes).toString("hex")}`;
}

export function computeSignature(secret: string, body: string, timestampSeconds: number): string {
  return createHmac("sha256", secret).update(`${timestampSeconds}.${body}`, "utf8").digest("hex");
}

export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},${SIGNATURE_VERSION}=${computeSignature(secret, body, timestampSeconds)}`;
}

export function parseSignatureHeader(header: string): SignatureParts {
  const parts = header.split(",").map((part) => part.trim());
  let timestamp: number | undefined;
  const signatures: string[] = [];
  for (const part of parts) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "t") timestamp = Number(value);
    else if (key === SIGNATURE_VERSION) signatures.push(value);
  }
  if (timestamp === undefined || !Number.isFinite(timestamp) || signatures.length === 0) {
    throw new DomainError(`Malformed signature header: '${header}'`, "INVALID_SIGNATURE", 400);
  }
  return { timestamp, signatures };
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export interface VerifyOptions {
  /** Seconds of clock skew / delivery lag tolerated. */
  readonly toleranceSeconds?: number;
  /** Current time in epoch seconds; injectable for tests. */
  readonly nowSeconds?: number;
}

export type SignatureFailure = "malformed" | "expired" | "mismatch";

export interface VerificationResult {
  readonly valid: boolean;
  readonly reason?: SignatureFailure;
  /** Index of the secret that matched, for rotation diagnostics. */
  readonly matchedSecretIndex?: number;
}

/**
 * Verifies a signature header against a body and an ordered list of accepted
 * secrets (current first, then any within their rotation grace window).
 */
export function verifySignature(
  header: string,
  body: string,
  secrets: readonly string[],
  options: VerifyOptions = {},
): VerificationResult {
  let parts: SignatureParts;
  try {
    parts = parseSignatureHeader(header);
  } catch {
    return { valid: false, reason: "malformed" };
  }
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parts.timestamp) > tolerance) {
    return { valid: false, reason: "expired" };
  }
  for (let index = 0; index < secrets.length; index++) {
    const expected = computeSignature(secrets[index]!, body, parts.timestamp);
    if (parts.signatures.some((candidate) => constantTimeEquals(candidate, expected))) {
      return { valid: true, matchedSecretIndex: index };
    }
  }
  return { valid: false, reason: "mismatch" };
}

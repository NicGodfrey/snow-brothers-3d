import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { SecretGenerator, Signer } from "../application/ports.js";

/** URL-safe random tokens for webhook secrets and invitation links. */
export class RandomSecretGenerator implements SecretGenerator {
  generate(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }
}

/** Predictable tokens so tests can assert on exact values. */
export class SequentialSecretGenerator implements SecretGenerator {
  private counter = 0;

  constructor(private readonly prefix = "secret") {}

  generate(bytes = 32): string {
    this.counter += 1;
    const body = `${this.prefix}-${String(this.counter).padStart(4, "0")}`;
    return body.padEnd(Math.max(16, Math.min(bytes, 48)), "x");
  }
}

/**
 * HMAC-SHA256 over `<timestamp>.<body>`, the scheme most webhook receivers
 * already implement. Including the timestamp inside the signed payload is what
 * makes a captured request unusable later.
 */
export class HmacSigner implements Signer {
  sign(secret: string, timestamp: string, body: string): string {
    return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  }
}

/** Constant-time comparison for receivers verifying a signature. */
export function verifySignature(
  signer: Signer,
  secret: string,
  timestamp: string,
  body: string,
  presented: string,
): boolean {
  const expected = signer.sign(secret, timestamp, body);
  const candidate = presented.startsWith("sha256=") ? presented.slice(7) : presented;
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(candidate));
}

/** Rejects a signature whose timestamp is outside the tolerance window. */
export function isFreshSignature(timestamp: string, nowMs: number, toleranceMs = 300_000): boolean {
  const at = Date.parse(timestamp);
  return Number.isFinite(at) && Math.abs(nowMs - at) <= toleranceMs;
}

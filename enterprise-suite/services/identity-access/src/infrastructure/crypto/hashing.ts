import { createHash, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { PasswordHash, SecretHash } from "../../domain/credential.js";
import type { PasswordHasher, SecretHasher, TokenGenerator } from "../../application/ports.js";

/**
 * PBKDF2-SHA512 password hashing. Real deployments should move to Argon2id behind the
 * same `PasswordHasher` port; the iteration count is a constructor parameter so tests can
 * drop it without weakening the default.
 */
export class Pbkdf2PasswordHasher implements PasswordHasher {
  constructor(
    private readonly iterations = 210_000,
    private readonly keyLength = 64,
  ) {}

  hash(plaintext: string, now: IsoDateTime): PasswordHash {
    const salt = randomBytes(16);
    const derived = pbkdf2Sync(plaintext, salt, this.iterations, this.keyLength, "sha512");
    return {
      algorithm: "pbkdf2-sha512",
      iterations: this.iterations,
      saltB64: salt.toString("base64"),
      hashB64: derived.toString("base64"),
      updatedAt: now,
    };
  }

  /** Re-derives with the stored parameters so old hashes keep verifying after a bump. */
  verify(plaintext: string, hash: PasswordHash): boolean {
    const salt = Buffer.from(hash.saltB64, "base64");
    const expected = Buffer.from(hash.hashB64, "base64");
    const derived = pbkdf2Sync(plaintext, salt, hash.iterations, expected.length, "sha512");
    return constantTimeEquals(derived, expected);
  }

  /** True when a stored hash was produced with weaker parameters than the current ones. */
  needsRehash(hash: PasswordHash): boolean {
    return hash.iterations < this.iterations;
  }
}

/**
 * Salted SHA-256 for bearer secrets. Tokens are high-entropy random strings, so a fast
 * digest is appropriate here — the slow KDF above exists for human-chosen passwords.
 */
export class Sha256SecretHasher implements SecretHasher {
  hash(plaintext: string): SecretHash {
    const salt = randomBytes(16);
    return {
      algorithm: "sha256",
      saltB64: salt.toString("base64"),
      hashB64: digest(plaintext, salt).toString("base64"),
    };
  }

  verify(plaintext: string, hash: SecretHash): boolean {
    const salt = Buffer.from(hash.saltB64, "base64");
    return constantTimeEquals(digest(plaintext, salt), Buffer.from(hash.hashB64, "base64"));
  }
}

export class RandomTokenGenerator implements TokenGenerator {
  secret(bytes = 32): string {
    return randomBytes(bytes).toString("base64url");
  }

  prefix(length = 10): string {
    return randomBytes(length).toString("base64url").slice(0, length).toLowerCase();
  }
}

/**
 * Deterministic generator for tests and seeds. Never wire this into anything that issues
 * real credentials.
 */
export class SequentialTokenGenerator implements TokenGenerator {
  private counter = 0;

  constructor(private readonly seed = "test") {}

  secret(): string {
    this.counter += 1;
    return `${this.seed}secret${String(this.counter).padStart(4, "0")}`;
  }

  prefix(): string {
    this.counter += 1;
    return `${this.seed}pfx${String(this.counter).padStart(4, "0")}`;
  }
}

function digest(plaintext: string, salt: Buffer): Buffer {
  return createHash("sha256").update(salt).update(plaintext, "utf8").digest();
}

function constantTimeEquals(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Stable, non-reversible fingerprint used to correlate a token across log lines. */
export function fingerprint(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

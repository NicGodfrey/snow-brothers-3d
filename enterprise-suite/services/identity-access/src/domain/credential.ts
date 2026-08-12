import type { IsoDateTime } from "@enterprise-suite/shared-kernel";

/**
 * Only derived material is ever stored. Plaintext secrets exist for the duration of a
 * single call and are returned to the caller exactly once at issue time.
 */
export interface PasswordHash {
  readonly algorithm: "pbkdf2-sha512";
  readonly iterations: number;
  readonly saltB64: string;
  readonly hashB64: string;
  readonly updatedAt: IsoDateTime;
}

/** Digest of a bearer secret (API key or session token). Salted, never reversible. */
export interface SecretHash {
  readonly algorithm: "sha256";
  readonly saltB64: string;
  readonly hashB64: string;
}

export interface PasswordPolicy {
  readonly minLength: number;
  readonly requireUppercase: boolean;
  readonly requireLowercase: boolean;
  readonly requireDigit: boolean;
  readonly requireSymbol: boolean;
  /** How many previous hashes are kept and rejected on reuse. 0 disables the check. */
  readonly historySize: number;
  /** Passwords older than this must be rotated at next login. 0 disables expiry. */
  readonly maxAgeDays: number;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 12,
  requireUppercase: true,
  requireLowercase: true,
  requireDigit: true,
  requireSymbol: false,
  historySize: 5,
  maxAgeDays: 365,
};

export interface PasswordComplaint {
  readonly rule: string;
  readonly message: string;
}

/** Pure policy check; returns every violated rule so the UI can show them all at once. */
export function checkPasswordComplexity(
  password: string,
  policy: PasswordPolicy,
): readonly PasswordComplaint[] {
  const complaints: PasswordComplaint[] = [];
  if (password.length < policy.minLength) {
    complaints.push({
      rule: "minLength",
      message: `must be at least ${policy.minLength} characters`,
    });
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    complaints.push({ rule: "requireUppercase", message: "must contain an uppercase letter" });
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    complaints.push({ rule: "requireLowercase", message: "must contain a lowercase letter" });
  }
  if (policy.requireDigit && !/[0-9]/.test(password)) {
    complaints.push({ rule: "requireDigit", message: "must contain a digit" });
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    complaints.push({ rule: "requireSymbol", message: "must contain a symbol" });
  }
  return complaints;
}

export function passwordAgeDays(hash: PasswordHash, now: IsoDateTime): number {
  const then = Date.parse(hash.updatedAt);
  const nowMs = Date.parse(now);
  return Math.floor((nowMs - then) / 86_400_000);
}

export function isPasswordExpired(
  hash: PasswordHash,
  policy: PasswordPolicy,
  now: IsoDateTime,
): boolean {
  return policy.maxAgeDays > 0 && passwordAgeDays(hash, now) >= policy.maxAgeDays;
}

/** Redacts derived material so aggregates can be serialized into API responses. */
export function redactPasswordHash(hash: PasswordHash | undefined): {
  algorithm: string;
  updatedAt: IsoDateTime;
} | undefined {
  return hash ? { algorithm: hash.algorithm, updatedAt: hash.updatedAt } : undefined;
}

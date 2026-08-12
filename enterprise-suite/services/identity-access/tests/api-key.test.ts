import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatApiKeyToken, parseApiKeyToken } from "../src/domain/api-key.js";
import { IDENTITY_ERROR, IdentityError, ValidationError } from "../src/domain/errors.js";
import { apiKeySubject } from "../src/domain/subject.js";
import { emptyTenant, makeModule, seeded } from "./helpers.js";

describe("API key tokens", () => {
  it("round-trips the prefix and secret", () => {
    const token = formatApiKeyToken("abc123", "s3cr3t");
    assert.equal(token, "esk_abc123_s3cr3t");
    assert.deepEqual(parseApiKeyToken(token), { prefix: "abc123", secret: "s3cr3t" });
  });

  it("rejects a malformed token before touching storage", () => {
    for (const bad of ["esk_only", "wrong_abc_def", "esk__missing"]) {
      assert.throws(() => parseApiKeyToken(bad), ValidationError);
    }
  });
});

describe("issuing keys", () => {
  it("returns the plaintext once and stores only a digest", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const issued = module.apiKeys.issue(tenantId, { name: "reporting-sync" });

    assert.ok(issued.token.startsWith("esk_"));
    const stored = module.apiKeys.get(tenantId, issued.apiKey.id);
    const serialized = JSON.stringify(stored.toPublicJSON());
    assert.ok(!serialized.includes(parseApiKeyToken(issued.token).secret));
    assert.ok(!serialized.includes("hashB64"));
    assert.ok(module.secretHasher.verify(parseApiKeyToken(issued.token).secret, stored.secret));
  });

  it("binds the requested roles to the key's own subject", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const issued = module.apiKeys.issue(tenantId, {
      name: "warehouse-sync",
      roleCodes: ["integration_client"],
    });
    const bindings = module.bindings.list(tenantId, {
      subject: apiKeySubject(issued.apiKey.id),
      activeOnly: true,
    });
    assert.equal(bindings.length, 1);
    assert.equal(bindings[0].roleCode, "integration_client");
  });

  it("honours the tenant default TTL and expires on schedule", () => {
    const { module, clock } = makeModule();
    const tenantId = emptyTenant(module);
    module.tenants.updateSettings(tenantId, { apiKeyPolicy: { defaultTtlDays: 30 } });
    const issued = module.apiKeys.issue(tenantId, { name: "short-lived" });

    assert.ok(issued.apiKey.expiresAt);
    assert.ok(issued.apiKey.isUsableAt(clock.now()));
    clock.advanceDays(31);
    assert.ok(!issued.apiKey.isUsableAt(clock.now()));

    const error = captureError(() => module.apiKeys.verify(issued.token));
    assert.equal(error.code, IDENTITY_ERROR.apiKeyExpired);
  });

  it("enforces the active key cap", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.tenants.updateSettings(tenantId, { apiKeyPolicy: { maxActiveKeys: 2 } });
    module.apiKeys.issue(tenantId, { name: "key-one" });
    module.apiKeys.issue(tenantId, { name: "key-two" });
    assert.throws(
      () => module.apiKeys.issue(tenantId, { name: "key-three" }),
      (error: IdentityError) => error.code === IDENTITY_ERROR.apiKeyLimitReached,
    );

    const first = module.apiKeys.list(tenantId)[0];
    module.apiKeys.revoke(tenantId, first.id, { reason: "making room" });
    assert.ok(module.apiKeys.issue(tenantId, { name: "key-three" }).apiKey);
  });
});

describe("verifying keys", () => {
  it("accepts a valid key and records the use", () => {
    const { module, refs } = seeded();
    const verified = module.apiKeys.verify(refs.apiKey.token);
    assert.equal(verified.tenantId, refs.tenantId);
    assert.equal(verified.apiKey.useCount, 1);
    assert.equal(verified.apiKey.lastUsedAt, module.clock.now());
  });

  it("rejects a revoked key", () => {
    const { module, refs } = seeded();
    module.apiKeys.revoke(refs.tenantId, refs.apiKey.id, { reason: "leaked" });
    const error = captureError(() => module.apiKeys.verify(refs.apiKey.token));
    assert.equal(error.code, IDENTITY_ERROR.apiKeyRevoked);
  });

  it("revokes the key's bindings when the key is revoked", () => {
    const { module, refs } = seeded();
    module.apiKeys.revoke(refs.tenantId, refs.apiKey.id, { reason: "leaked" });
    assert.equal(
      module.bindings.list(refs.tenantId, {
        subject: apiKeySubject(refs.apiKey.id),
        activeOnly: true,
      }).length,
      0,
    );
  });

  it("rejects a key presented from outside its IP allowlist", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    const issued = module.apiKeys.issue(tenantId, {
      name: "office-only",
      ipAllowlist: ["198.51.100.*", "203.0.113.9"],
    });

    assert.ok(module.apiKeys.verify(issued.token, { ip: "198.51.100.44" }));
    assert.ok(module.apiKeys.verify(issued.token, { ip: "203.0.113.9" }));
    const error = captureError(() => module.apiKeys.verify(issued.token, { ip: "192.0.2.1" }));
    assert.equal(error.code, IDENTITY_ERROR.ipNotAllowed);
  });

  it("skips the allowlist when the tenant disables enforcement", () => {
    const { module } = makeModule();
    const tenantId = emptyTenant(module);
    module.tenants.updateSettings(tenantId, { apiKeyPolicy: { enforceIpAllowlist: false } });
    const issued = module.apiKeys.issue(tenantId, {
      name: "office-only",
      ipAllowlist: ["198.51.100.*"],
    });
    assert.ok(module.apiKeys.verify(issued.token, { ip: "192.0.2.1" }));
  });

  it("refuses a key belonging to a suspended tenant", () => {
    const { module, refs } = seeded();
    module.tenants.suspend(refs.tenantId, "non-payment");
    const error = captureError(() => module.apiKeys.verify(refs.apiKey.token));
    assert.equal(error.code, IDENTITY_ERROR.tenantInactive);
  });

  it("writes an authn audit entry on success and on failure", () => {
    const { module, refs } = seeded();
    module.apiKeys.verify(refs.apiKey.token);
    captureError(() => module.apiKeys.verify(`esk_${refs.apiKey.token.split("_")[1]}_wrong`));

    const entries = module.audit.list(refs.tenantId, { category: "authn", action: "authn.api_key" });
    assert.ok(entries.some((entry) => entry.outcome === "success"));
    assert.ok(entries.some((entry) => entry.outcome === "failure"));
  });
});

describe("rotation and restrictions", () => {
  it("invalidates the previous secret on rotation", () => {
    const { module, refs } = seeded();
    const old = refs.apiKey.token;
    const rotated = module.apiKeys.rotate(refs.tenantId, refs.apiKey.id, refs.users.owner);

    assert.notEqual(rotated.token, old);
    assert.ok(module.apiKeys.verify(rotated.token));
    assert.throws(() => module.apiKeys.verify(old));
  });

  it("keeps the prefix stable across rotation so the key stays identifiable", () => {
    const { module, refs } = seeded();
    const before = module.apiKeys.get(refs.tenantId, refs.apiKey.id).prefix;
    const rotated = module.apiKeys.rotate(refs.tenantId, refs.apiKey.id);
    assert.equal(rotated.apiKey.prefix, before);
  });

  it("narrows an existing key's reach", () => {
    const { module, refs } = seeded();
    const key = module.apiKeys.restrict(refs.tenantId, refs.apiKey.id, ["sales.order:read"]);
    assert.ok(key.permits("sales.order:read" as never));
    assert.ok(!key.permits("sales.order:create" as never));
  });

  it("sweeps expired keys into a revoked state", () => {
    const { module, clock, refs } = seeded();
    clock.advanceDays(91);
    assert.equal(module.apiKeys.sweepExpired(refs.tenantId), 1);
    assert.equal(module.apiKeys.get(refs.tenantId, refs.apiKey.id).status, "revoked");
  });
});

function captureError(fn: () => unknown): IdentityError {
  try {
    fn();
  } catch (error) {
    return error as IdentityError;
  }
  throw new Error("expected the call to throw");
}

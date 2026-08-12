import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatApiKeyToken, parseApiKeyToken } from "../src/domain/api-key.js";
import { formatSessionToken, parseSessionToken } from "../src/domain/session.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { Pbkdf2PasswordHasher, RandomTokenGenerator } from "../src/infrastructure/crypto/hashing.js";
import { createIdentityModule } from "../src/infrastructure/container.js";
import { seedDemoTenant, SEED_PASSWORD } from "../src/fixtures/seed.js";
import { asUlid } from "../src/domain/ids.js";

/**
 * The rest of the suite runs on the deterministic token generator, which never emits the
 * `-`/`_` characters of the base64url alphabet. These cases pin the production generator,
 * because a secret containing `_` is what breaks a parser that counts token segments.
 */
function productionModule() {
  return createIdentityModule({
    clock: new FixedClock("2026-03-01T09:00:00.000Z"),
    passwordHasher: new Pbkdf2PasswordHasher(1000),
    tokens: new RandomTokenGenerator(),
  });
}

describe("random token generation", () => {
  it("never puts an underscore in an API key lookup prefix", () => {
    const tokens = new RandomTokenGenerator();
    for (let i = 0; i < 500; i += 1) {
      const prefix = tokens.prefix();
      assert.equal(prefix.length, 10);
      assert.match(prefix, /^[a-z0-9]{10}$/);
    }
  });

  it("produces base64url secrets of the requested entropy", () => {
    const tokens = new RandomTokenGenerator();
    const secret = tokens.secret(32);
    assert.match(secret, /^[A-Za-z0-9_-]+$/);
    assert.equal(Buffer.from(secret, "base64url").length, 32);
    assert.notEqual(secret, tokens.secret(32));
  });
});

describe("parsing secrets that contain the separator", () => {
  it("keeps an underscore-bearing session secret intact", () => {
    const sessionId = asUlid("sess_msq2ztt0dg1s9xeq");
    const secret = "1EAQ93Q2y_Eho4HoQVMjwU51ceRAuUJPlgQ5ujLkIsQ";
    const parsed = parseSessionToken(formatSessionToken(sessionId, secret));
    assert.equal(parsed.sessionId, sessionId);
    assert.equal(parsed.secret, secret);
  });

  it("keeps an underscore-bearing API key secret intact", () => {
    const secret = "aa_bb_cc-dd";
    const parsed = parseApiKeyToken(formatApiKeyToken("abc123", secret));
    assert.equal(parsed.prefix, "abc123");
    assert.equal(parsed.secret, secret);
  });
});

describe("credentials issued by the production generator", () => {
  it("accepts a session token it just issued", () => {
    const module = productionModule();
    const refs = seedDemoTenant(module);
    const { token, refreshToken } = module.authentication.loginWithPassword(refs.tenantId, {
      email: "ada.owner@northwind.example",
      password: SEED_PASSWORD,
    });

    const principal = module.authentication.authenticateBearer(`Bearer ${token}`);
    assert.equal(principal.tenantId, refs.tenantId);
    assert.equal(principal.subject.id, refs.users.owner);

    assert.ok(refreshToken);
    const refreshed = module.sessions.refresh(refreshToken);
    assert.ok(module.authentication.authenticateBearer(refreshed.token));
  });

  it("accepts an API key it just issued", () => {
    const module = productionModule();
    const refs = seedDemoTenant(module);
    const issued = module.apiKeys.issue(refs.tenantId, {
      name: "format-check",
      createdBy: refs.users.securityAdmin,
    });

    const principal = module.authentication.authenticateBearer(issued.token);
    assert.equal(principal.apiKeyId, issued.apiKey.id);

    const rotated = module.apiKeys.rotate(refs.tenantId, issued.apiKey.id);
    assert.ok(module.authentication.authenticateBearer(rotated.token));
    assert.throws(() => module.authentication.authenticateBearer(issued.token), {
      message: /Invalid API key/,
    });
  });
});

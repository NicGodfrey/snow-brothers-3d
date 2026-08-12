import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { IDENTITY_ERROR, IdentityError } from "../src/domain/errors.js";
import { parseSessionToken } from "../src/domain/session.js";
import { SEED_PASSWORD, seeded } from "./helpers.js";

const OWNER = "ada.owner@northwind.example";

describe("password authentication", () => {
  it("issues a session and a refresh token", () => {
    const { module, refs } = seeded();
    const result = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
      device: { ip: "203.0.113.7", userAgent: "test-agent" },
    });
    assert.ok(result.token.startsWith("est_"));
    assert.ok(result.refreshToken);
    assert.equal(result.session.userId, refs.users.owner);
    assert.deepEqual([...result.session.amr], ["password"]);
    assert.equal(result.user.lastLoginAt, module.clock.now());
  });

  it("gives the same answer for an unknown email and a wrong password", () => {
    const { module, refs } = seeded();
    const unknown = captureError(() =>
      module.authentication.loginWithPassword(refs.tenantId, {
        email: "nobody@northwind.example",
        password: SEED_PASSWORD,
      }),
    );
    const wrong = captureError(() =>
      module.authentication.loginWithPassword(refs.tenantId, {
        email: OWNER,
        password: "incorrect",
      }),
    );
    assert.equal(unknown.code, wrong.code);
    assert.equal(unknown.message, wrong.message);
    assert.equal(unknown.status, 401);
  });

  it("refuses to sign in a user who never completed the invitation", () => {
    const { module, refs } = seeded();
    module.users.invite(refs.tenantId, {
      email: "pending@northwind.example",
      displayName: "Pending Person",
    });
    const error = captureError(() =>
      module.authentication.loginWithPassword(refs.tenantId, {
        email: "pending@northwind.example",
        password: SEED_PASSWORD,
      }),
    );
    assert.equal(error.code, IDENTITY_ERROR.userNotActive);
  });

  it("demands a second factor once the user is enrolled", () => {
    const { module, refs } = seeded();
    module.users.enrollMfa(refs.tenantId, {
      userId: refs.users.owner,
      method: "totp",
      label: "phone",
      secret: "SECRET",
    });
    const error = captureError(() =>
      module.authentication.loginWithPassword(refs.tenantId, { email: OWNER, password: SEED_PASSWORD }),
    );
    assert.equal(error.code, IDENTITY_ERROR.mfaRequired);

    const result = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
      mfaCode: "123456",
    });
    assert.ok(result.session.mfaSatisfied);
    assert.deepEqual([...result.session.amr], ["password", "totp"]);
  });
});

describe("session verification", () => {
  it("resolves a token into a principal and slides the idle deadline", () => {
    const { module, clock, refs } = seeded();
    const { token, session } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    const firstExpiry = session.expiresAt;

    clock.advanceMinutes(30);
    const principal = module.authentication.authenticateSessionToken(token);
    assert.equal(principal.subject.id, refs.users.owner);
    assert.ok(module.sessions.get(refs.tenantId, session.id).expiresAt > firstExpiry);
  });

  it("never lets the idle deadline pass the absolute deadline", () => {
    const { module, clock, refs } = seeded();
    const { token, session } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    const absolute = session.absoluteExpiresAt;

    for (let i = 0; i < 20; i += 1) {
      clock.advanceMinutes(30);
      try {
        module.sessions.verify(token);
      } catch {
        break;
      }
    }
    assert.ok(module.sessions.get(refs.tenantId, session.id).expiresAt <= absolute);
  });

  it("rejects a token whose secret does not match", () => {
    const { module, refs } = seeded();
    const { token } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    const tampered = `${token.slice(0, -4)}zzzz`;
    const error = captureError(() => module.sessions.verify(tampered));
    assert.equal(error.status, 401);
  });

  it("expires an idle session and marks it expired", () => {
    const { module, clock, refs } = seeded();
    const { token, session } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    clock.advanceSeconds(module.tenants.settings(refs.tenantId).sessionPolicy.idleTtlSeconds + 1);
    const error = captureError(() => module.sessions.verify(token));
    assert.equal(error.code, IDENTITY_ERROR.sessionExpired);
    assert.equal(module.sessions.get(refs.tenantId, session.id).status, "expired");
  });

  it("rejects a revoked session with a distinct code", () => {
    const { module, refs } = seeded();
    const { token, session } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    module.sessions.revoke(refs.tenantId, session.id, "test");
    const error = captureError(() => module.sessions.verify(token));
    assert.equal(error.code, IDENTITY_ERROR.sessionRevoked);
  });
});

describe("refresh", () => {
  it("rotates both halves so the old tokens stop working", () => {
    const { module, clock, refs } = seeded();
    const first = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    clock.advanceMinutes(5);
    const second = module.sessions.refresh(first.refreshToken as string);

    assert.notEqual(second.token, first.token);
    assert.notEqual(second.refreshToken, first.refreshToken);
    assert.equal(second.session.refreshCount, 1);
    module.sessions.verify(second.token);
    assert.throws(() => module.sessions.verify(first.token));
  });

  it("kills the session when a refresh token does not verify", () => {
    const { module, refs } = seeded();
    const { refreshToken, session } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    const tampered = `${(refreshToken as string).slice(0, -4)}0000`;
    assert.throws(() => module.sessions.refresh(tampered));
    assert.equal(
      module.sessions.get(refs.tenantId, session.id).status,
      "revoked",
      "a replayed refresh token is treated as a compromise, not a typo",
    );
  });

  it("refuses to refresh when the tenant disables it", () => {
    const { module, refs } = seeded();
    const login = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    module.tenants.updateSettings(refs.tenantId, { sessionPolicy: { refreshEnabled: false } });
    const error = captureError(() => module.sessions.refresh(login.refreshToken as string));
    assert.equal(error.code, IDENTITY_ERROR.refreshNotEnabled);
  });
});

describe("session lifecycle management", () => {
  it("evicts the least recently used session past the concurrency cap", () => {
    const { module, clock, refs } = seeded();
    const tokens: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      tokens.push(
        module.authentication.loginWithPassword(refs.tenantId, {
          email: OWNER,
          password: SEED_PASSWORD,
        }).token,
      );
      clock.advanceMinutes(1);
    }
    assert.equal(module.sessions.listForUser(refs.tenantId, refs.users.owner, { activeOnly: true }).length, 3);

    module.authentication.loginWithPassword(refs.tenantId, { email: OWNER, password: SEED_PASSWORD });
    const active = module.sessions.listForUser(refs.tenantId, refs.users.owner, { activeOnly: true });
    assert.equal(active.length, 3, "the tenant caps concurrency at three");
    assert.throws(() => module.sessions.verify(tokens[0]), "the oldest session was evicted");
  });

  it("revokes every session for a user at once", () => {
    const { module, refs } = seeded();
    module.authentication.loginWithPassword(refs.tenantId, { email: OWNER, password: SEED_PASSWORD });
    module.authentication.loginWithPassword(refs.tenantId, { email: OWNER, password: SEED_PASSWORD });
    assert.equal(module.sessions.revokeAllForUser(refs.tenantId, refs.users.owner, "admin"), 2);
    assert.equal(module.sessions.listForUser(refs.tenantId, refs.users.owner, { activeOnly: true }).length, 0);
  });

  it("sweeps lapsed sessions", () => {
    const { module, clock, refs } = seeded();
    module.authentication.loginWithPassword(refs.tenantId, { email: OWNER, password: SEED_PASSWORD });
    clock.advanceHours(24);
    assert.equal(module.sessions.sweepExpired(refs.tenantId), 1);
    assert.equal(module.sessions.sweepExpired(refs.tenantId), 0);
  });

  it("records who is behind an impersonated session", () => {
    const { module, refs } = seeded();
    const result = module.authentication.impersonate(refs.tenantId, {
      actorId: refs.users.owner,
      targetUserId: refs.users.salesRep,
      reason: "support ticket 4711",
    });
    assert.equal(result.session.impersonatedBy, refs.users.owner);
    const principal = module.authentication.authenticateSessionToken(result.token);
    assert.equal(principal.subject.id, refs.users.salesRep);
    assert.equal(principal.impersonatedBy, refs.users.owner);

    const entries = module.audit.list(refs.tenantId, { action: "admin.user.impersonated" });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].reason, "support ticket 4711");
  });

  it("stops accepting a session once its user is suspended", () => {
    const { module, refs } = seeded();
    const { token } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    module.users.suspend(refs.tenantId, refs.users.owner, "investigation");
    const error = captureError(() => module.authentication.authenticateSessionToken(token));
    assert.ok(error.status === 401 || error.status === 403);
  });
});

describe("token format", () => {
  it("round-trips the session id out of a token", () => {
    const { module, refs } = seeded();
    const { token, session } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    assert.equal(parseSessionToken(token).sessionId, session.id);
  });

  it("routes a bearer credential to the right verifier", () => {
    const { module, refs } = seeded();
    const { token } = module.authentication.loginWithPassword(refs.tenantId, {
      email: OWNER,
      password: SEED_PASSWORD,
    });
    assert.equal(
      module.authentication.authenticateBearer(`Bearer ${token}`).subject.type,
      "user",
    );
    assert.equal(
      module.authentication.authenticateBearer(refs.apiKey.token).subject.type,
      "api_key",
    );
    assert.throws(() => module.authentication.authenticateBearer("Bearer nonsense"));
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

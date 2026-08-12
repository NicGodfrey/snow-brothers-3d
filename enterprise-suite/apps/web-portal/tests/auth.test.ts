import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DomainError,
  ForbiddenError,
  signSuiteToken,
  verifySuiteToken,
} from "@enterprise-suite/shared-kernel";
import { AuthService } from "../src/infrastructure/auth/auth-service.js";
import { Directory } from "../src/infrastructure/auth/directory.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { sessionHeaders } from "../src/domain/session.js";
import { NOW, USERS } from "./helpers.js";

function authService(trustHeaders = true): { auth: AuthService; clock: FixedClock } {
  const clock = new FixedClock(NOW);
  return {
    auth: new AuthService({
      secret: "test-secret",
      ttlMinutes: 60,
      clock,
      directory: new Directory(),
      trustHeaders,
    }),
    clock,
  };
}

describe("mock tokens", () => {
  it("round-trips claims and rejects tampering", () => {
    const claims = {
      userId: "u-avery",
      tenantId: "acme",
      roles: ["viewer"],
      sessionId: "sess-1",
      iat: 1,
      exp: Math.floor(Date.parse(NOW) / 1000) + 60,
    };
    const token = signSuiteToken(claims, "s3cret");
    assert.deepEqual(verifySuiteToken(token, "s3cret", { nowMs: Date.parse(NOW) }).roles, ["viewer"]);

    const [header, body, signature] = token.split(".");
    const forged = `${header}.${Buffer.from(
      JSON.stringify({ ...claims, roles: ["tenant-admin"] }),
    ).toString("base64url")}.${signature}`;
    assert.throws(
      () => verifySuiteToken(forged, "s3cret", { nowMs: Date.parse(NOW) }),
      /Bad suite token signature/,
    );
    assert.throws(
      () => verifySuiteToken(token, "other-secret", { nowMs: Date.parse(NOW) }),
      /Bad suite token signature/,
    );
    assert.throws(
      () => verifySuiteToken("nonsense", "s3cret", { nowMs: Date.parse(NOW) }),
      /Malformed suite token/,
    );
  });

  it("refuses expired tokens", () => {
    const { auth, clock } = authService();
    const { token } = auth.signIn({ email: USERS.salesManager, tenantId: "acme" });
    clock.advance(61 * 60_000);
    assert.throws(() => auth.sessionFromToken(token), /token expired/i);
  });
});

describe("sign-in", () => {
  it("resolves roles from the tenant membership", () => {
    const { auth } = authService();
    const acme = auth.signIn({ email: USERS.salesManager, tenantId: "acme" }).session;
    assert.deepEqual(acme.roles, ["sales-manager", "channel-manager"]);
    assert.ok(acme.permissions.has("sales:approve"));

    const globex = auth.signIn({ email: USERS.salesManager, tenantId: "globex" }).session;
    assert.deepEqual(globex.roles, ["viewer"]);
    assert.ok(!globex.permissions.has("sales:approve"));
  });

  it("rejects unknown users and tenants the user is not a member of", () => {
    const { auth } = authService();
    assert.throws(() => auth.signIn({ email: "nobody@acme.test" }), DomainError);
    assert.throws(
      () => auth.signIn({ email: USERS.marketer, tenantId: "globex" }),
      ForbiddenError,
    );
  });

  it("only lets an admin impersonate", () => {
    const { auth } = authService();
    assert.throws(
      () =>
        auth.signIn({
          email: USERS.buyer,
          tenantId: "acme",
          impersonateUserId: "u-rin",
        }),
      ForbiddenError,
    );

    const impersonated = auth.signIn({
      email: USERS.admin,
      tenantId: "acme",
      impersonateUserId: "u-rin",
    }).session;
    assert.equal(impersonated.user.userId, "u-rin");
    assert.equal(impersonated.impersonatedBy, "u-admin");
    assert.equal(sessionHeaders(impersonated)["x-on-behalf-of"], "u-admin");
  });

  it("switches tenants only within the user's memberships", () => {
    const { auth } = authService();
    const session = auth.signIn({ email: USERS.controller, tenantId: "acme" }).session;
    const switched = auth.switchTenant(session, "globex").session;
    assert.equal(switched.tenant.tenantId, "globex");
    assert.deepEqual(switched.roles, ["accountant"]);
    assert.equal(switched.sessionId, session.sessionId, "same browser session");
    assert.throws(() => auth.switchTenant(session, "initech"), ForbiddenError);
  });
});

describe("tenant headers", () => {
  it("builds the downstream header set", () => {
    const { auth } = authService();
    const session = auth.signIn({ email: USERS.buyer, tenantId: "acme" }).session;
    const headers = auth.headers(session);
    assert.equal(headers["x-tenant-id"], "acme");
    assert.equal(headers["x-user-id"], "u-jordan");
    assert.equal(headers["x-roles"], "buyer,warehouse-clerk");
    assert.match(headers.authorization ?? "", /^Bearer /);
  });

  it("adds a correlation id per outbound request", async () => {
    const { auth } = authService();
    const session = auth.signIn({ email: USERS.buyer, tenantId: "acme" }).session;
    const provider = auth.headerProvider(session);
    assert.equal((await provider.headers("req-1"))["x-correlation-id"], "req-1");
  });

  it("accepts gateway-injected principals and honours explicit roles", () => {
    const { auth } = authService();
    const session = auth.sessionFromHeaders({
      "x-tenant-id": "acme",
      "x-user-id": "u-jordan",
      "x-roles": "viewer",
    });
    assert.deepEqual(session?.roles, ["viewer"]);
    assert.equal(auth.sessionFromHeaders({ "x-user-id": "u-jordan" }), undefined);
  });

  it("refuses header auth when the deployment disables it", () => {
    const { auth } = authService(false);
    assert.throws(
      () => auth.sessionFromHeaders({ "x-tenant-id": "acme", "x-user-id": "u-jordan" }),
      ForbiddenError,
    );
  });
});

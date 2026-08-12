import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { signSuiteToken, verifySuiteToken, type SuiteTokenClaims } from "./suite-token.js";

const NOW = Date.parse("2026-08-12T18:00:00.000Z");
const SECRET = "test-suite-secret";
const CLAIMS: SuiteTokenClaims = {
  tenantId: "acme",
  userId: "u-123",
  roles: ["viewer", "buyer"],
  iat: Math.floor(NOW / 1000),
  exp: Math.floor(NOW / 1000) + 300,
};

describe("suite tokens", () => {
  it("round-trips verified tenant identity and roles", () => {
    const claims = verifySuiteToken(signSuiteToken(CLAIMS, SECRET), SECRET, { nowMs: NOW });
    assert.deepEqual(claims, CLAIMS);
  });

  it("rejects another secret, expiry, malformed tokens and unsupported algorithms", () => {
    const token = signSuiteToken(CLAIMS, SECRET);
    assert.throws(
      () => verifySuiteToken(token, "wrong-secret", { nowMs: NOW }),
      /Bad suite token signature/,
    );
    assert.throws(
      () => verifySuiteToken(token, SECRET, { nowMs: (CLAIMS.exp + 1) * 1000 }),
      /expired/,
    );
    assert.throws(() => verifySuiteToken("not-a-token", SECRET, { nowMs: NOW }), /Malformed/);

    const [, body, signature] = token.split(".");
    const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    assert.throws(
      () => verifySuiteToken(`${noneHeader}.${body}.${signature}`, SECRET, { nowMs: NOW }),
      /algorithm/,
    );
  });

  it("rejects a forged platform-admin role with the original signature", () => {
    const token = signSuiteToken(CLAIMS, SECRET);
    const [header, , signature] = token.split(".");
    const forgedClaims = Buffer.from(
      JSON.stringify({ ...CLAIMS, roles: ["platform-admin"] }),
      "utf8",
    ).toString("base64url");

    assert.throws(
      () => verifySuiteToken(`${header}.${forgedClaims}.${signature}`, SECRET, { nowMs: NOW }),
      /Bad suite token signature/,
    );
  });
});

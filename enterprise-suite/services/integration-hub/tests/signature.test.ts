import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DomainError } from "@enterprise-suite/shared-kernel";
import { canonicalJson, fingerprint, shortFingerprint } from "../src/domain/fingerprint.js";
import {
  computeSignature,
  DEFAULT_TOLERANCE_SECONDS,
  generateSecret,
  parseSignatureHeader,
  signPayload,
  verifySignature,
} from "../src/domain/signature.js";
import { addMs, atOrBefore, durationMs, earliest, epochSeconds, isoOf } from "../src/domain/time.js";

describe("canonical json", () => {
  it("is insensitive to key order at every depth", () => {
    const a = { b: 1, a: { z: [1, { y: 2, x: 3 }], y: true } };
    const b = { a: { y: true, z: [1, { x: 3, y: 2 }] }, b: 1 };
    assert.equal(canonicalJson(a), canonicalJson(b));
    assert.equal(fingerprint(a), fingerprint(b));
  });

  it("preserves array order and distinguishes real differences", () => {
    assert.notEqual(fingerprint([1, 2]), fingerprint([2, 1]));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: "1" }));
    assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 1, b: null }));
    assert.notEqual(fingerprint(null), fingerprint({}));
    assert.notEqual(fingerprint([]), fingerprint({}));
  });

  it("drops undefined members the way JSON.stringify does", () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
    assert.equal(fingerprint({ a: 1, b: undefined }), fingerprint({ a: 1 }));
  });

  it("renders dates and bigints deterministically", () => {
    assert.equal(canonicalJson(new Date("2026-08-12T09:00:00Z")), '"2026-08-12T09:00:00.000Z"');
    assert.equal(canonicalJson({ n: 10n }), '{"n":"10"}');
  });

  it("rejects values that cannot be hashed stably", () => {
    assert.throws(() => canonicalJson(Number.NaN), DomainError);
    assert.throws(() => canonicalJson({ x: Number.POSITIVE_INFINITY }), /non-finite/);
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic["self"] = cyclic;
    assert.throws(() => canonicalJson(cyclic), /cyclic/);
  });

  it("allows the same object to appear twice side by side", () => {
    const shared = { id: 1 };
    assert.equal(canonicalJson({ a: shared, b: shared }), '{"a":{"id":1},"b":{"id":1}}');
  });

  it("produces a short prefix for logs", () => {
    assert.equal(shortFingerprint({ a: 1 }).length, 16);
    assert.ok(fingerprint({ a: 1 }).startsWith(shortFingerprint({ a: 1 })));
  });
});

describe("webhook signatures", () => {
  const secret = "whsec_0123456789abcdef";
  const body = JSON.stringify({ eventType: "quality.ncr.opened", data: { ncr: "NCR-1" } });
  const timestamp = 1_786_000_000;

  it("signs deterministically in the versioned header format", () => {
    const header = signPayload(secret, body, timestamp);
    assert.equal(header, `t=${timestamp},v1=${computeSignature(secret, body, timestamp)}`);
    assert.equal(header, signPayload(secret, body, timestamp));

    const parts = parseSignatureHeader(header);
    assert.equal(parts.timestamp, timestamp);
    assert.equal(parts.signatures.length, 1);
    assert.match(parts.signatures[0]!, /^[0-9a-f]{64}$/);
  });

  it("binds the signature to both the body and the timestamp", () => {
    const header = signPayload(secret, body, timestamp);
    assert.equal(verifySignature(header, body, [secret], { nowSeconds: timestamp }).valid, true);
    assert.equal(
      verifySignature(header, body.replace("NCR-1", "NCR-2"), [secret], { nowSeconds: timestamp }).reason,
      "mismatch",
    );
    // Replaying the same body under a new timestamp does not validate.
    const replayed = `t=${timestamp + 10},v1=${computeSignature(secret, body, timestamp)}`;
    assert.equal(verifySignature(replayed, body, [secret], { nowSeconds: timestamp + 10 }).reason, "mismatch");
  });

  it("rejects a signature outside the tolerance window in either direction", () => {
    const header = signPayload(secret, body, timestamp);
    const at = (offset: number) => verifySignature(header, body, [secret], { nowSeconds: timestamp + offset });

    assert.equal(at(DEFAULT_TOLERANCE_SECONDS).valid, true);
    assert.equal(at(DEFAULT_TOLERANCE_SECONDS + 1).reason, "expired");
    assert.equal(at(-DEFAULT_TOLERANCE_SECONDS).valid, true);
    assert.equal(at(-DEFAULT_TOLERANCE_SECONDS - 1).reason, "expired");
    assert.equal(
      verifySignature(header, body, [secret], { nowSeconds: timestamp + 3_600, toleranceSeconds: 7_200 }).valid,
      true,
    );
  });

  it("accepts any secret in the rotation set and reports which one matched", () => {
    const rotated = "whsec_fedcba9876543210";
    const header = signPayload(secret, body, timestamp);
    const result = verifySignature(header, body, [rotated, secret], { nowSeconds: timestamp });

    assert.equal(result.valid, true);
    assert.equal(result.matchedSecretIndex, 1);
    assert.equal(verifySignature(header, body, [rotated], { nowSeconds: timestamp }).valid, false);
  });

  it("tolerates a header carrying several v1 signatures", () => {
    const other = "whsec_aaaabbbbccccdddd";
    const header = [
      `t=${timestamp}`,
      `v1=${computeSignature(other, body, timestamp)}`,
      `v1=${computeSignature(secret, body, timestamp)}`,
    ].join(",");
    assert.equal(verifySignature(header, body, [secret], { nowSeconds: timestamp }).valid, true);
  });

  it("treats a malformed header as invalid rather than throwing", () => {
    for (const header of ["", "garbage", "v1=abc", `t=${timestamp}`, "t=later,v1=abc"]) {
      assert.equal(verifySignature(header, body, [secret], { nowSeconds: timestamp }).reason, "malformed");
    }
    assert.throws(() => parseSignatureHeader("v1=abc"), DomainError);
    // An unknown scheme version is ignored, leaving no usable signature.
    assert.throws(() => parseSignatureHeader(`t=${timestamp},v2=abc`), /Malformed signature header/);
  });

  it("generates distinct prefixed secrets", () => {
    const secrets = new Set(Array.from({ length: 20 }, () => generateSecret()));
    assert.equal(secrets.size, 20);
    for (const value of secrets) {
      assert.ok(value.startsWith("whsec_"));
      assert.equal(value.length, "whsec_".length + 64);
    }
  });
});

describe("iso time arithmetic", () => {
  const base = isoOf("2026-08-12T09:00:00.000Z");

  it("adds, compares and measures", () => {
    assert.equal(addMs(base, 90_000), "2026-08-12T09:01:30.000Z");
    assert.equal(addMs(base, -1_000), "2026-08-12T08:59:59.000Z");
    assert.equal(atOrBefore(base, base), true);
    assert.equal(atOrBefore(addMs(base, 1), base), false);
    assert.equal(durationMs(base, addMs(base, 5_000)), 5_000);
    assert.equal(earliest(addMs(base, 10), base), base);
    assert.equal(epochSeconds(base), Math.floor(Date.parse(base) / 1000));
  });

  it("normalises inputs and rejects nonsense", () => {
    assert.equal(isoOf("2026-08-12T11:00:00+02:00"), base);
    assert.throws(() => isoOf("not-a-date"), DomainError);
  });
});

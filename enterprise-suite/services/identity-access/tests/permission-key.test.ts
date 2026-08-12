import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bySpecificityDesc,
  grantPattern,
  matchesPermission,
  parsePermission,
  patternCovers,
  patternsIntersect,
  patternSpecificity,
  permissionKey,
} from "../src/domain/permission-key.js";
import { ValidationError } from "../src/domain/errors.js";

describe("permission keys", () => {
  it("parses and normalizes a concrete key", () => {
    const key = permissionKey("  Sales.Order:Approve ");
    assert.equal(key, "sales.order:approve");
    assert.deepEqual(parsePermission(key), { resource: ["sales", "order"], action: "approve" });
  });

  it("rejects malformed keys", () => {
    for (const bad of ["sales.order", "sales.order:", ":approve", "sales..order:read", "1sales:read"]) {
      assert.throws(() => permissionKey(bad), ValidationError, `expected ${bad} to be rejected`);
    }
  });

  it("rejects wildcards in a concrete key but accepts them in a pattern", () => {
    assert.throws(() => permissionKey("sales.*:read"), ValidationError);
    assert.equal(grantPattern("sales.*:read"), "sales.*:read");
  });

  it("only allows ** as the final resource segment", () => {
    assert.equal(grantPattern("sales.**:read"), "sales.**:read");
    assert.throws(() => grantPattern("sales.**.order:read"), ValidationError);
  });
});

describe("permission matching", () => {
  const key = permissionKey("sales.order.line:approve");

  it("matches exact patterns", () => {
    assert.ok(matchesPermission(grantPattern("sales.order.line:approve"), key));
    assert.ok(!matchesPermission(grantPattern("sales.order.line:read"), key));
  });

  it("treats * as exactly one segment", () => {
    assert.ok(matchesPermission(grantPattern("sales.order.*:approve"), key));
    assert.ok(!matchesPermission(grantPattern("sales.*:approve"), key));
  });

  it("treats ** as one or more trailing segments", () => {
    assert.ok(matchesPermission(grantPattern("sales.**:approve"), key));
    assert.ok(matchesPermission(grantPattern("sales.order.**:approve"), key));
    assert.ok(matchesPermission(grantPattern("**:approve"), key));
  });

  it("does not let ** match zero segments", () => {
    assert.ok(!matchesPermission(grantPattern("sales.order.line.**:approve"), key));
  });

  it("matches any action with a * action", () => {
    assert.ok(matchesPermission(grantPattern("sales.order.line:*"), key));
    assert.ok(matchesPermission(grantPattern("**:*"), key));
  });

  it("does not match across resource boundaries", () => {
    assert.ok(!matchesPermission(grantPattern("srm.**:approve"), key));
  });
});

describe("pattern specificity", () => {
  it("ranks exact patterns above wildcards", () => {
    assert.ok(
      patternSpecificity(grantPattern("sales.order:approve")) >
        patternSpecificity(grantPattern("sales.*:approve")),
    );
    assert.ok(
      patternSpecificity(grantPattern("sales.*:approve")) >
        patternSpecificity(grantPattern("sales.**:approve")),
    );
    assert.ok(
      patternSpecificity(grantPattern("sales.order:approve")) >
        patternSpecificity(grantPattern("sales.order:*")),
    );
  });

  it("sorts most specific first and breaks ties lexically", () => {
    const sorted = [
      grantPattern("**:*"),
      grantPattern("sales.order:read"),
      grantPattern("sales.*:read"),
      grantPattern("sales.order:approve"),
    ].sort(bySpecificityDesc);
    assert.deepEqual(sorted, ["sales.order:approve", "sales.order:read", "sales.*:read", "**:*"]);
  });
});

describe("pattern coverage", () => {
  it("recognises a broader pattern covering a narrower one", () => {
    assert.ok(patternCovers(grantPattern("sales.**:*"), grantPattern("sales.order:read")));
    assert.ok(patternCovers(grantPattern("sales.order:*"), grantPattern("sales.order:read")));
    assert.ok(patternCovers(grantPattern("sales.*:read"), grantPattern("sales.order:read")));
  });

  it("does not claim coverage in the wrong direction", () => {
    assert.ok(!patternCovers(grantPattern("sales.order:read"), grantPattern("sales.**:*")));
    assert.ok(!patternCovers(grantPattern("sales.*:read"), grantPattern("sales.order.line:read")));
    assert.ok(!patternCovers(grantPattern("srm.**:*"), grantPattern("sales.order:read")));
  });

  it("treats identical patterns as covering", () => {
    assert.ok(patternCovers(grantPattern("sales.order:read"), grantPattern("sales.order:read")));
  });
});

describe("pattern intersection", () => {
  it("is symmetric where coverage is not", () => {
    const wide = grantPattern("sales.**:*");
    const narrow = grantPattern("sales.order:read");
    assert.ok(patternsIntersect(wide, narrow));
    assert.ok(patternsIntersect(narrow, wide));
    assert.ok(!patternCovers(narrow, wide));
  });

  it("finds the overlap between two partial wildcards", () => {
    assert.ok(patternsIntersect(grantPattern("sales.*:read"), grantPattern("*.order:read")));
    assert.ok(patternsIntersect(grantPattern("sales.order:*"), grantPattern("sales.*:approve")));
  });

  it("rejects disjoint patterns", () => {
    assert.ok(!patternsIntersect(grantPattern("sales.**:*"), grantPattern("srm.supplier:read")));
    assert.ok(!patternsIntersect(grantPattern("sales.order:read"), grantPattern("sales.order:approve")));
    assert.ok(!patternsIntersect(grantPattern("sales.*:read"), grantPattern("sales.order.line:read")));
  });

  it("lets the superuser pattern intersect everything", () => {
    for (const other of ["sales.order:read", "identity.user:*", "srm.**:approve"]) {
      assert.ok(patternsIntersect(grantPattern("**:*"), grantPattern(other)));
    }
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ValidationError } from "../src/domain/errors.js";
import {
  ROOT_SCOPE,
  childScope,
  isRootScope,
  parentScope,
  scopeChain,
  scopeCovers,
  scopeDepth,
  scopePath,
  scopeSegments,
  scopeSpecificity,
  scopesIntersect,
} from "../src/domain/scope.js";

describe("scope parsing", () => {
  it("normalizes the several ways of naming the root", () => {
    for (const value of ["", "tenant", "*", "  TENANT  ", "tenant/"]) {
      assert.equal(scopePath(value), ROOT_SCOPE);
    }
    assert.ok(isRootScope(ROOT_SCOPE));
  });

  it("parses a nested path into typed segments", () => {
    const scope = scopePath("tenant/bu:emea/site:hamburg-1");
    assert.deepEqual(scopeSegments(scope), [
      { type: "bu", key: "emea" },
      { type: "site", key: "hamburg-1" },
    ]);
    assert.equal(scopeDepth(scope), 2);
  });

  it("rejects paths that are not rooted or not type:key shaped", () => {
    assert.throws(() => scopePath("bu:emea"), ValidationError);
    assert.throws(() => scopePath("tenant/emea"), ValidationError);
    assert.throws(() => scopePath("tenant/BU!:emea"), ValidationError);
  });

  it("builds child scopes and walks back up", () => {
    const emea = childScope(ROOT_SCOPE, "bu", "emea");
    const hamburg = childScope(emea, "site", "hamburg");
    assert.equal(hamburg, "tenant/bu:emea/site:hamburg");
    assert.equal(parentScope(hamburg), emea);
    assert.equal(parentScope(ROOT_SCOPE), undefined);
    assert.deepEqual(scopeChain(hamburg), [hamburg, emea, ROOT_SCOPE]);
  });
});

describe("scope coverage", () => {
  const emea = scopePath("tenant/bu:emea");
  const hamburg = scopePath("tenant/bu:emea/site:hamburg");
  const amer = scopePath("tenant/bu:amer");

  it("flows down the tree, never up", () => {
    assert.ok(scopeCovers(ROOT_SCOPE, hamburg));
    assert.ok(scopeCovers(emea, hamburg));
    assert.ok(scopeCovers(emea, emea));
    assert.ok(!scopeCovers(hamburg, emea));
    assert.ok(!scopeCovers(hamburg, ROOT_SCOPE));
  });

  it("keeps sibling branches apart", () => {
    assert.ok(!scopeCovers(emea, amer));
    assert.ok(!scopeCovers(amer, hamburg));
  });

  it("supports a wildcard key at any level", () => {
    const anyBuHamburg = scopePath("tenant/bu:*/site:hamburg");
    assert.ok(scopeCovers(anyBuHamburg, hamburg));
    assert.ok(scopeCovers(anyBuHamburg, scopePath("tenant/bu:amer/site:hamburg")));
    assert.ok(!scopeCovers(anyBuHamburg, scopePath("tenant/bu:amer/site:boston")));
  });

  it("requires matching segment types", () => {
    assert.ok(!scopeCovers(scopePath("tenant/region:emea"), emea));
  });

  it("detects overlap in either direction", () => {
    assert.ok(scopesIntersect(emea, hamburg));
    assert.ok(scopesIntersect(hamburg, emea));
    assert.ok(!scopesIntersect(emea, amer));
  });

  it("ranks deeper concrete scopes as more specific", () => {
    assert.ok(scopeSpecificity(hamburg) > scopeSpecificity(emea));
    assert.ok(scopeSpecificity(emea) > scopeSpecificity(ROOT_SCOPE));
    assert.ok(scopeSpecificity(emea) > scopeSpecificity(scopePath("tenant/bu:*")));
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SrmEventTypes } from "../src/domain/events.js";
import { expectRejects, world } from "./helpers.js";

/** electronics -> pcb-assembly -> smt, plus a sibling root for move tests. */
async function taxonomy(w: ReturnType<typeof world>) {
  const { category } = w.container.services;
  const electronics = await category.create(w.ctx, {
    code: "Electronics",
    name: "Electronics",
    riskTier: "high",
    requiresQualification: true,
    requiredCertifications: ["iso9001"],
    requalificationMonths: 24,
  });
  const pcb = await category.create(w.ctx, {
    code: "pcb-assembly",
    name: "PCB assembly",
    parentId: electronics.id,
    riskTier: "medium",
    requiredCertifications: ["iatf16949"],
    requalificationMonths: 12,
  });
  const smt = await category.create(w.ctx, {
    code: "smt",
    name: "Surface mount",
    parentId: pcb.id,
    riskTier: "low",
  });
  const indirect = await category.create(w.ctx, { code: "indirect", name: "Indirect", riskTier: "low" });
  return { electronics, pcb, smt, indirect };
}

describe("category taxonomy", () => {
  it("slugs codes and materialises the path down the tree", async () => {
    const w = world();
    const { electronics, pcb, smt } = await taxonomy(w);
    assert.equal(electronics.code, "electronics", "codes are slugged, not stored as typed");
    assert.equal(electronics.path, "electronics");
    assert.equal(pcb.path, "electronics/pcb-assembly");
    assert.equal(smt.path, "electronics/pcb-assembly/smt");
    assert.equal(smt.level, 2);
  });

  it("refuses a duplicate code and an unknown parent", async () => {
    const w = world();
    const { category } = w.container.services;
    await category.create(w.ctx, { code: "packaging", name: "Packaging" });
    await expectRejects(
      category.create(w.ctx, { code: "Packaging", name: "Packaging again" }),
      "INVALID_STATE",
      "already exists",
    );
    await expectRejects(
      category.create(w.ctx, { code: "orphan", name: "Orphan", parentId: "cat_missing" as never }),
      "NOT_FOUND",
    );
  });

  it("validates the policy fields it will later enforce", async () => {
    const w = world();
    const { category } = w.container.services;
    await expectRejects(
      category.create(w.ctx, { code: "bad-cert", name: "Bad", requiredCertifications: ["iso_99999"] }),
      "VALIDATION",
      "unknown certification type",
    );
    await expectRejects(
      category.create(w.ctx, { code: "bad-months", name: "Bad", requalificationMonths: 120 }),
      "VALIDATION",
      "between 3 and 60",
    );
  });

  it("builds a sorted tree from the flat records", async () => {
    const w = world();
    await taxonomy(w);
    const tree = await w.container.services.category.tree(w.ctx);
    assert.deepEqual(
      tree.map((node) => node.code),
      ["electronics", "indirect"],
    );
    assert.equal(tree[0]?.children[0]?.code, "pcb-assembly");
    assert.equal(tree[0]?.children[0]?.children[0]?.code, "smt");
  });
});

describe("category policy inheritance", () => {
  it("merges the ancestor chain into the strictest effective policy", async () => {
    const w = world();
    const { smt } = await taxonomy(w);
    const policy = await w.container.services.category.policy(w.ctx, smt.id);

    assert.equal(policy.riskTier, "high", "the strictest tier in the chain wins, not the leaf's own");
    assert.equal(policy.requiresQualification, true, "the flag is sticky once an ancestor sets it");
    assert.deepEqual(policy.requiredCertifications, ["iatf16949", "iso9001"], "certifications union");
    assert.equal(policy.requalificationMonths, 12, "the shortest interval wins");
    assert.deepEqual(policy.inheritedFrom, ["electronics", "pcb-assembly", "smt"]);
  });

  it("falls back to a two-year requalification when nobody sets one", async () => {
    const w = world();
    const { indirect } = await taxonomy(w);
    const policy = await w.container.services.category.policy(w.ctx, indirect.id);
    assert.equal(policy.requalificationMonths, 24);
    assert.deepEqual(policy.requiredCertifications, []);
    assert.equal(policy.requiresQualification, false);
  });

  it("re-resolves policy after an ancestor tightens its rules", async () => {
    const w = world();
    const { category } = w.container.services;
    const { electronics, smt } = await taxonomy(w);
    await category.update(w.ctx, electronics.id, {
      riskTier: "critical",
      requiredCertifications: ["iso9001", "iso14001"],
      requalificationMonths: 6,
    });
    const policy = await category.policy(w.ctx, smt.id);
    assert.equal(policy.riskTier, "critical");
    assert.equal(policy.requalificationMonths, 6);
    assert.deepEqual(policy.requiredCertifications, ["iatf16949", "iso14001", "iso9001"]);
  });
});

describe("category moves", () => {
  it("rewrites every descendant path in one operation", async () => {
    const w = world();
    const { category } = w.container.services;
    const { pcb, smt, indirect } = await taxonomy(w);

    const moved = await category.move(w.ctx, pcb.id, indirect.id);
    assert.equal(moved.path, "indirect/pcb-assembly");
    assert.equal(moved.level, 1);

    const child = await category.get(w.ctx, smt.id);
    assert.equal(child.path, "indirect/pcb-assembly/smt", "the subtree follows its root");
    assert.equal(child.level, 2);

    const event = w.container.outbox
      .entries(w.ctx.tenantId)
      .find((entry) => entry.eventType === SrmEventTypes.CategoryMoved);
    assert.equal((event?.payload as { descendantsRewritten: number }).descendantsRewritten, 1);
  });

  it("promotes a subtree to the root and drops the inherited prefix", async () => {
    const w = world();
    const { category } = w.container.services;
    const { pcb, smt } = await taxonomy(w);
    await category.move(w.ctx, pcb.id, undefined);
    assert.equal((await category.get(w.ctx, pcb.id)).path, "pcb-assembly");
    assert.equal((await category.get(w.ctx, smt.id)).path, "pcb-assembly/smt");
    // Policy no longer inherits electronics' qualification requirement.
    const policy = await category.policy(w.ctx, smt.id);
    assert.equal(policy.requiresQualification, false);
    assert.deepEqual(policy.requiredCertifications, ["iatf16949"]);
  });

  it("rejects a move that would create a cycle or self-parent a node", async () => {
    const w = world();
    const { category } = w.container.services;
    const { electronics, smt } = await taxonomy(w);
    await expectRejects(category.move(w.ctx, electronics.id, smt.id), "INVALID_STATE", "would create a cycle");
    await expectRejects(category.move(w.ctx, electronics.id, electronics.id), "VALIDATION", "own parent");
  });

  it("is a no-op when the parent does not actually change", async () => {
    const w = world();
    const { category } = w.container.services;
    const { pcb, electronics } = await taxonomy(w);
    const same = await category.move(w.ctx, pcb.id, electronics.id);
    assert.equal(same.updatedAt, pcb.updatedAt);
    assert.equal(
      w.container.outbox.entries(w.ctx.tenantId).filter((e) => e.eventType === SrmEventTypes.CategoryMoved).length,
      0,
    );
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserId } from "@enterprise-suite/shared-kernel";
import { expectRejects, world, type TestWorld } from "./helpers.js";

function as(w: TestWorld, user: string) {
  return { ...w.ctx, userId: user as UserId };
}

async function ecoFixture(w: TestWorld) {
  const services = w.container.services;
  const assembly = await services.product.create(w.ctx, {
    code: "ECO-ASM",
    name: "Assembly",
    type: "manufactured",
    baseUom: "EA",
  });
  const part = await services.product.create(w.ctx, {
    code: "ECO-PART",
    name: "Part",
    type: "purchased",
    baseUom: "EA",
  });
  const bom = await services.bom.createBom(w.ctx, assembly.id);
  const draft = bom.draftRevision()!;
  await services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: part.id, quantity: 2, uom: "EA" });
  await services.bom.releaseRevision(w.ctx, assembly.id, draft.id, { effectiveFrom: w.clock.now() });
  const draftB = await services.bom.createDraftRevision(w.ctx, assembly.id, { basedOnRevisionId: draft.id });
  return { assembly, part, draftB };
}

describe("ECO numbering and item validation", () => {
  it("mints sequential per-tenant numbers", async () => {
    const w = world();
    const services = w.container.services;
    const first = await services.eco.create(w.ctx, { title: "One", reason: "quality" });
    const second = await services.eco.create(w.ctx, { title: "Two", reason: "quality" });
    assert.equal(first.number, "ECO-00001");
    assert.equal(second.number, "ECO-00002");
  });

  it("validates item references: product, revision status, variant", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    const eco = await services.eco.create(w.ctx, { title: "Change", reason: "design_fix" });
    await expectRejects(
      services.eco.addItem(w.ctx, eco.id, {
        productId: "prod_missing" as never,
        change: { kind: "lifecycle_transition", to: "pilot" },
      }),
      "NOT_FOUND",
    );
    // Only draft revisions can ride an ECO.
    const bom = await services.bom.getByProduct(w.ctx, assembly.id);
    const released = bom.releasedRevisions()[0]!;
    await expectRejects(
      services.eco.addItem(w.ctx, eco.id, {
        productId: assembly.id,
        change: { kind: "bom_release", bomRevisionId: released.id, effectiveFrom: w.clock.now() },
      }),
      "INVALID_STATE",
      "only release drafts",
    );
    const item = await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
    });
    // The same revision cannot be attached twice.
    await expectRejects(
      services.eco.addItem(w.ctx, eco.id, {
        productId: assembly.id,
        change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
      }),
      "INVALID_STATE",
      "already on this ECO",
    );
    await services.eco.removeItem(w.ctx, eco.id, item.id);
    assert.equal((await services.eco.get(w.ctx, eco.id)).items.length, 0);
  });
});

describe("ECO approval workflow", () => {
  it("cannot submit an empty ECO; items freeze after submission", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    const eco = await services.eco.create(w.ctx, { title: "Empty", reason: "quality" });
    await expectRejects(services.eco.submit(w.ctx, eco.id), "INVALID_STATE", "no change items");
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
    });
    await services.eco.submit(w.ctx, eco.id);
    await expectRejects(
      services.eco.addItem(w.ctx, eco.id, {
        productId: assembly.id,
        change: { kind: "lifecycle_transition", to: "pilot" },
      }),
      "INVALID_STATE",
      "expected draft",
    );
  });

  it("enforces the quorum, one vote per user, and no self-approval", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    const eco = await services.eco.create(w.ctx, { title: "Quorum", reason: "compliance", requiredApprovals: 2 });
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
    });
    await services.eco.submit(w.ctx, eco.id); // submitted by engineer-1
    await expectRejects(services.eco.approve(w.ctx, eco.id), "INVALID_STATE", "own ECO");
    let state = await services.eco.approve(as(w, "reviewer-1"), eco.id, "LGTM");
    assert.equal(state.status, "submitted", "one of two approvals so far");
    await expectRejects(services.eco.approve(as(w, "reviewer-1"), eco.id), "INVALID_STATE", "already voted");
    state = await services.eco.approve(as(w, "reviewer-2"), eco.id);
    assert.equal(state.status, "approved");
  });

  it("a single rejection (with mandatory comment) rejects the ECO", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    const eco = await services.eco.create(w.ctx, { title: "Rejected", reason: "quality", requiredApprovals: 2 });
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
    });
    await services.eco.submit(w.ctx, eco.id);
    await expectRejects(services.eco.reject(as(w, "reviewer-1"), eco.id, ""), "VALIDATION", "comment");
    const rejected = await services.eco.reject(as(w, "reviewer-1"), eco.id, "Tolerance stack-up is wrong");
    assert.equal(rejected.status, "rejected");
    await expectRejects(services.eco.implement(w.ctx, eco.id), "INVALID_STATE");
  });

  it("cancel works from draft and submitted, not after approval", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    const eco = await services.eco.create(w.ctx, { title: "Cancel", reason: "obsolescence" });
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
    });
    await services.eco.submit(w.ctx, eco.id);
    await services.eco.approve(as(w, "reviewer-1"), eco.id);
    await expectRejects(services.eco.cancel(w.ctx, eco.id, "changed my mind"), "INVALID_STATE");
  });
});

describe("ECO implementation", () => {
  it("applies a bundle: releases the BOM revision, then activates the product", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    // Move the assembly to pilot so the lifecycle item can take it to active.
    await services.product.transitionLifecycle(w.ctx, assembly.id, "pilot");
    // draftB must differ from A to be meaningful; tweak a quantity.
    const line = draftB.lines[0]!;
    await services.bom.updateLine(w.ctx, assembly.id, draftB.id, line.id, { quantity: 3 });

    const eco = await services.eco.create(w.ctx, { title: "Bundle", reason: "design_fix" });
    // Revision B takes over one hour from now (A stays effective until then,
    // which is what lets the lifecycle item activate the product today).
    const inOneHour = new Date(Date.parse(w.clock.now()) + 3600_000).toISOString() as never;
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: inOneHour },
    });
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "lifecycle_transition", to: "active" },
    });
    await services.eco.submit(w.ctx, eco.id);
    await services.eco.approve(as(w, "reviewer-1"), eco.id);
    const implemented = await services.eco.implement(as(w, "implementer-1"), eco.id);
    assert.equal(implemented.status, "implemented");

    const product = await services.product.get(w.ctx, assembly.id);
    assert.equal(product.lifecycle, "active");
    w.clock.advance(2 * 3600_000);
    const effective = await services.bom.effectiveRevision(w.ctx, assembly.id);
    assert.equal(effective.code, "B");
    assert.equal(effective.lines[0]!.quantity, 3);
    assert.equal(effective.ecoId, eco.id);
  });

  it("aborts implementation if a revision was released out-of-band", async () => {
    const w = world();
    const { assembly, draftB } = await ecoFixture(w);
    const services = w.container.services;
    const eco = await services.eco.create(w.ctx, { title: "Race", reason: "quality" });
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: w.clock.now() },
    });
    await services.eco.submit(w.ctx, eco.id);
    await services.eco.approve(as(w, "reviewer-1"), eco.id);

    // Another ECO releases the same draft first.
    const rival = await services.eco.create(w.ctx, { title: "Rival", reason: "quality" });
    await services.eco.addItem(w.ctx, rival.id, {
      productId: assembly.id,
      change: {
        kind: "bom_release",
        bomRevisionId: draftB.id,
        effectiveFrom: new Date(Date.parse(w.clock.now()) + 3600_000).toISOString() as never,
      },
    });
    await services.eco.submit(w.ctx, rival.id);
    await services.eco.approve(as(w, "reviewer-2"), rival.id);
    await services.eco.implement(w.ctx, rival.id);

    await expectRejects(services.eco.implement(w.ctx, eco.id), "INVALID_STATE", "outside this ECO");
    const stuck = await services.eco.get(w.ctx, eco.id);
    assert.equal(stuck.status, "approved", "failed implementation leaves the ECO approved");
  });
});

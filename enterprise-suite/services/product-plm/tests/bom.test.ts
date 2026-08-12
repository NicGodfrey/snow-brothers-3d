import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IsoDateTime, Ulid } from "@enterprise-suite/shared-kernel";
import { nextRevisionCode } from "../src/domain/bom.js";
import { summarizeExplosion } from "../src/domain/explosion.js";
import { seedDemoData } from "../src/infrastructure/seed.js";
import { DAY_MS, expectRejects, world, type TestWorld } from "./helpers.js";

function iso(base: string, plusDays: number): IsoDateTime {
  return new Date(Date.parse(base) + plusDays * DAY_MS).toISOString() as IsoDateTime;
}

async function makeAssembly(w: TestWorld) {
  const { container, ctx } = w;
  const services = container.services;
  const assembly = await services.product.create(ctx, { code: "ASM-1", name: "Assembly", type: "manufactured", baseUom: "EA" });
  const partA = await services.product.create(ctx, { code: "PART-A", name: "Part A", type: "purchased", baseUom: "EA" });
  const partB = await services.product.create(ctx, { code: "PART-B", name: "Part B", type: "purchased", baseUom: "KG" });
  const bom = await services.bom.createBom(ctx, assembly.id);
  return { assembly, partA, partB, bom, draft: bom.draftRevision()! };
}

describe("revision codes", () => {
  it("follows the alpha sequence A..Z, AA, AB", () => {
    assert.equal(nextRevisionCode([]), "A");
    assert.equal(nextRevisionCode(["A"]), "B");
    assert.equal(nextRevisionCode(["A", "B", "C"]), "D");
    assert.equal(nextRevisionCode(["Z"]), "AA");
    assert.equal(nextRevisionCode(["AA"]), "AB");
    assert.equal(nextRevisionCode(["AZ"]), "BA");
  });
});

describe("BOM structure rules", () => {
  it("only make-items carry BOMs, and only one per product", async () => {
    const w = world();
    const services = w.container.services;
    const buy = await services.product.create(w.ctx, { code: "BUY-1", name: "B", type: "purchased", baseUom: "EA" });
    await expectRejects(services.bom.createBom(w.ctx, buy.id), "INVALID_STATE", "manufactured/phantom");
    const make = await services.product.create(w.ctx, { code: "MAKE-1", name: "M", type: "manufactured", baseUom: "EA" });
    await services.bom.createBom(w.ctx, make.id);
    await expectRejects(services.bom.createBom(w.ctx, make.id), "CONFLICT", "already has a BOM");
  });

  it("rejects self-reference, duplicates, bad quantities and bad scrap", async () => {
    const w = world();
    const { assembly, partA, draft } = await makeAssembly(w);
    const services = w.container.services;
    await expectRejects(
      services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: assembly.id, quantity: 1, uom: "EA" }),
      "VALIDATION",
      "its own product",
    );
    await services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 1, uom: "EA" });
    await expectRejects(
      services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 2, uom: "EA" }),
      "CONFLICT",
      "already on revision",
    );
    await expectRejects(
      services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 0, uom: "EA" }),
      "VALIDATION",
    );
    await expectRejects(
      services.bom.addLine(w.ctx, assembly.id, draft.id, {
        componentProductId: partA.id,
        quantity: 1,
        uom: "EA",
        scrapFactor: 0.95,
      }),
      "VALIDATION",
    );
  });

  it("rejects lines whose unit cannot convert to the component's base unit", async () => {
    const w = world();
    const { assembly, partB, draft } = await makeAssembly(w);
    await expectRejects(
      w.container.services.bom.addLine(w.ctx, assembly.id, draft.id, {
        componentProductId: partB.id, // base unit KG
        quantity: 1,
        uom: "M",
      }),
      "VALIDATION",
      "not convertible",
    );
    const line = await w.container.services.bom.addLine(w.ctx, assembly.id, draft.id, {
      componentProductId: partB.id,
      quantity: 500,
      uom: "G",
    });
    assert.equal(line.uom, "G");
  });

  it("prevents cycles across the whole BOM graph", async () => {
    const w = world();
    const services = w.container.services;
    const a = await services.product.create(w.ctx, { code: "CYC-A", name: "A", type: "manufactured", baseUom: "EA" });
    const b = await services.product.create(w.ctx, { code: "CYC-B", name: "B", type: "manufactured", baseUom: "EA" });
    const c = await services.product.create(w.ctx, { code: "CYC-C", name: "C", type: "manufactured", baseUom: "EA" });
    const bomA = await services.bom.createBom(w.ctx, a.id);
    await services.bom.addLine(w.ctx, a.id, bomA.draftRevision()!.id, { componentProductId: b.id, quantity: 1, uom: "EA" });
    const bomB = await services.bom.createBom(w.ctx, b.id);
    await services.bom.addLine(w.ctx, b.id, bomB.draftRevision()!.id, { componentProductId: c.id, quantity: 1, uom: "EA" });
    const bomC = await services.bom.createBom(w.ctx, c.id);
    // C -> A would close the loop A -> B -> C -> A.
    await expectRejects(
      services.bom.addLine(w.ctx, c.id, bomC.draftRevision()!.id, { componentProductId: a.id, quantity: 1, uom: "EA" }),
      "CONFLICT",
      "cycle",
    );
  });
});

describe("release and effectivity", () => {
  it("releases a draft and makes it effective from its window start", async () => {
    const w = world();
    const { assembly, partA, draft } = await makeAssembly(w);
    const services = w.container.services;
    await expectRejects(
      services.bom.releaseRevision(w.ctx, assembly.id, draft.id, { effectiveFrom: w.clock.now() }),
      "INVALID_STATE",
      "no lines",
    );
    await services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 4, uom: "EA" });
    const released = await services.bom.releaseRevision(w.ctx, assembly.id, draft.id, { effectiveFrom: w.clock.now() });
    assert.equal(released.status, "released");
    const effective = await services.bom.effectiveRevision(w.ctx, assembly.id);
    assert.equal(effective.id, released.id);
    // Before the window there is no effective revision.
    await expectRejects(
      services.bom.effectiveRevision(w.ctx, assembly.id, iso(w.clock.now(), -1)),
      "NOT_FOUND",
    );
  });

  it("released revisions are immutable; a single draft is allowed at a time", async () => {
    const w = world();
    const { assembly, partA, draft } = await makeAssembly(w);
    const services = w.container.services;
    await services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 1, uom: "EA" });
    await services.bom.releaseRevision(w.ctx, assembly.id, draft.id, { effectiveFrom: w.clock.now() });
    await expectRejects(
      services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 9, uom: "EA" }),
      "INVALID_STATE",
      "immutable",
    );
    const draftB = await services.bom.createDraftRevision(w.ctx, assembly.id, { basedOnRevisionId: draft.id });
    assert.equal(draftB.code, "B");
    assert.equal(draftB.lines.length, 1);
    assert.notEqual(draftB.lines[0]!.id, draft.lines[0]!.id, "copied lines get fresh ids");
    await expectRejects(services.bom.createDraftRevision(w.ctx, assembly.id), "CONFLICT", "draft");
  });

  it("supersedes the open-ended predecessor on release (via ECO)", async () => {
    const w = world();
    const { assembly, partA, partB, draft } = await makeAssembly(w);
    const services = w.container.services;
    const t0 = w.clock.now();
    await services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 1, uom: "EA" });
    await services.bom.releaseRevision(w.ctx, assembly.id, draft.id, { effectiveFrom: t0 });

    const draftB = await services.bom.createDraftRevision(w.ctx, assembly.id, { basedOnRevisionId: draft.id });
    await services.bom.addLine(w.ctx, assembly.id, draftB.id, { componentProductId: partB.id, quantity: 1, uom: "KG" });

    // Approve an ECO covering the release of revision B at t0+10d.
    const eco = await services.eco.create(w.ctx, { title: "Add part B", reason: "design_fix" });
    await services.eco.addItem(w.ctx, eco.id, {
      productId: assembly.id,
      change: { kind: "bom_release", bomRevisionId: draftB.id, effectiveFrom: iso(t0, 10) },
    });
    await services.eco.submit(w.ctx, eco.id);
    const approverCtx = { ...w.ctx, userId: "approver-9" as typeof w.ctx.userId };
    await services.eco.approve(approverCtx, eco.id);
    await services.eco.implement(w.ctx, eco.id);

    const bom = await services.bom.getByProduct(w.ctx, assembly.id);
    const revA = bom.revisions.find((r) => r.code === "A")!;
    const revB = bom.revisions.find((r) => r.code === "B")!;
    assert.equal(revA.effectiveTo, iso(t0, 10), "predecessor window truncated");
    assert.equal(revB.status, "released");
    assert.equal(revB.ecoId, eco.id, "release is traceable to the ECO");
    assert.equal(bom.effectiveRevision(iso(t0, 5))!.code, "A");
    assert.equal(bom.effectiveRevision(iso(t0, 15))!.code, "B");
  });

  it("requires an approved ECO for any release after the first", async () => {
    const w = world();
    const { assembly, partA, draft } = await makeAssembly(w);
    const services = w.container.services;
    await services.bom.addLine(w.ctx, assembly.id, draft.id, { componentProductId: partA.id, quantity: 1, uom: "EA" });
    await services.bom.releaseRevision(w.ctx, assembly.id, draft.id, { effectiveFrom: w.clock.now() });
    const draftB = await services.bom.createDraftRevision(w.ctx, assembly.id, { basedOnRevisionId: draft.id });
    await expectRejects(
      services.bom.releaseRevision(w.ctx, assembly.id, draftB.id, { effectiveFrom: iso(w.clock.now(), 1) }),
      "INVALID_STATE",
      "require an approved ECO",
    );
    // A draft (unapproved) ECO does not authorize it either.
    const eco = await services.eco.create(w.ctx, { title: "Not approved", reason: "quality" });
    await expectRejects(
      services.bom.releaseRevision(w.ctx, assembly.id, draftB.id, {
        effectiveFrom: iso(w.clock.now(), 1),
        ecoId: eco.id,
      }),
      "INVALID_STATE",
      "only approved ECOs",
    );
  });
});

describe("multi-level explosion", () => {
  it("explodes the seeded skateboard, converting units and applying scrap", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const services = w.container.services;
    const result = await services.bom.explode(seeded.ctx, seeded.products["SKATE-COMP-100"]!, { quantity: 10 });
    // Phantom HW-KIT is flattened away: bolts/nuts hang off the complete.
    const codes = result.root.children.map((c) => c.productCode);
    assert.ok(codes.includes("BOLT-M5") && codes.includes("NUT-M5"));
    assert.ok(!codes.includes("HW-KIT"));

    const summary = summarizeExplosion(result);
    const byCode = new Map(summary.map((l) => [l.productCode, l]));
    assert.equal(byCode.get("VENEER-MAPLE")!.totalQuantity, 73.5); // 10 × 7 × 1.05
    assert.equal(byCode.get("GRIP-TAPE")!.totalQuantity, 8.8); // 10 × 0.8 × 1.1, in M
    assert.equal(byCode.get("GRIP-TAPE")!.uom, "M");
    assert.equal(byCode.get("TRUCK-539")!.totalQuantity, 20);
    assert.equal(byCode.get("BOLT-M5")!.totalQuantity, 80);
    assert.equal(byCode.get("ASSEMBLY-LABOR")!.totalQuantity, 5);
    // Intermediate assemblies are not procurement requirements.
    assert.equal(byCode.has("DECK-MAPLE"), false);
  });

  it("keeps phantom nodes when flattening is disabled", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const result = await w.container.services.bom.explode(seeded.ctx, seeded.products["SKATE-COMP-100"]!, {
      flattenPhantoms: false,
    });
    const kit = result.root.children.find((c) => c.productCode === "HW-KIT");
    assert.ok(kit, "phantom visible in engineering view");
    assert.deepEqual(kit!.children.map((c) => c.productCode).sort(), ["BOLT-M5", "NUT-M5"]);
  });

  it("honors effectivity dates in the explosion", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const services = w.container.services;
    // Approve + implement the pending wheel-swap ECO (effective in 30 days).
    const approver = { ...seeded.ctx, userId: "approver-2" as typeof seeded.ctx.userId };
    await services.eco.approve(approver, seeded.pendingEcoId);
    await services.eco.implement(seeded.ctx, seeded.pendingEcoId);

    const completeId = seeded.products["SKATE-COMP-100"]!;
    const now = w.clock.now();
    const before = await services.bom.explode(seeded.ctx, completeId, { at: iso(now, 1) });
    const after = await services.bom.explode(seeded.ctx, completeId, { at: iso(now, 31) });
    const codesAt = (r: typeof before) => r.root.children.map((c) => c.productCode);
    assert.ok(codesAt(before).includes("WHEEL-54"));
    assert.ok(!codesAt(before).includes("WHEEL-56"));
    assert.ok(codesAt(after).includes("WHEEL-56"));
    assert.ok(!codesAt(after).includes("WHEEL-54"));
  });
});

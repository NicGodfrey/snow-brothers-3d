import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlmEventTypes } from "../src/domain/events.js";
import { seedDemoData } from "../src/infrastructure/seed.js";
import { expectRejects, world } from "./helpers.js";

describe("cost rollup on the seeded skateboard", () => {
  it("rolls up the deck: veneer and grip tape with scrap and unit conversion", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const result = await w.container.services.costing.rollUp(seeded.ctx, {
      productId: seeded.products["DECK-MAPLE"]!,
    });
    // veneer: 7 EA × 1.05 scrap × 350 = 2572.5 -> 2573; grip: 0.8 M × 1.1 × 200 = 176
    assert.equal(result.root.unitCost.amountMinor, 2749);
    assert.equal(result.root.source, "rollup");
    assert.equal(result.incomplete, false);
    const grip = result.root.components.find((c) => c.component.productCode === "GRIP-TAPE")!;
    assert.equal(grip.extendedCost.amountMinor, 176);
    assert.equal(grip.uom, "M");
  });

  it("rolls up three levels through the phantom kit", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const result = await w.container.services.costing.rollUp(seeded.ctx, {
      productId: seeded.products["SKATE-COMP-100"]!,
    });
    // deck 2749 + trucks 2500 + wheels 1600 + bearings 1200 + kit 72 + labor 1500
    assert.equal(result.root.unitCost.amountMinor, 9621);
    const kit = result.root.components.find((c) => c.component.productCode === "HW-KIT")!;
    assert.equal(kit.component.source, "rollup");
    assert.equal(kit.extendedCost.amountMinor, 72);
    const labor = result.root.components.find((c) => c.component.productCode === "ASSEMBLY-LABOR")!;
    assert.equal(labor.component.source, "standard");
    assert.equal(labor.extendedCost.amountMinor, 1500);
  });

  it("marks missing leaf costs instead of failing, and refuses to persist them", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const services = w.container.services;
    // A new uncosted purchased part lands on a fresh assembly.
    const rare = await services.product.create(seeded.ctx, {
      code: "RARE-EARTH",
      name: "Uncosted magnet",
      type: "purchased",
      baseUom: "EA",
    });
    const asm = await services.product.create(seeded.ctx, {
      code: "ASM-MAG",
      name: "Magnet assembly",
      type: "manufactured",
      baseUom: "EA",
    });
    const bom = await services.bom.createBom(seeded.ctx, asm.id);
    await services.bom.addLine(seeded.ctx, asm.id, bom.draftRevision()!.id, {
      componentProductId: rare.id,
      quantity: 2,
      uom: "EA",
    });
    await services.bom.releaseRevision(seeded.ctx, asm.id, bom.draftRevision()!.id, {
      effectiveFrom: w.clock.now(),
    });
    const result = await services.costing.rollUp(seeded.ctx, { productId: asm.id });
    assert.equal(result.incomplete, true);
    assert.deepEqual(result.missing.map((m) => m.productCode), ["RARE-EARTH"]);
    assert.equal(result.root.unitCost.amountMinor, 0);
    await expectRejects(
      services.costing.applyRollup(seeded.ctx, { productId: asm.id }),
      "CONFLICT",
      "missing standard costs",
    );
  });

  it("applies a complete rollup as the product's standard cost and emits an event", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    const services = w.container.services;
    const completeId = seeded.products["SKATE-COMP-100"]!;
    await services.costing.applyRollup(seeded.ctx, { productId: completeId });
    const product = await services.product.get(seeded.ctx, completeId);
    assert.equal(product.standardCost?.amountMinor, 9621);
    const costEvents = w.container.outbox
      .entries(seeded.ctx.tenantId)
      .filter((e) => e.eventType === PlmEventTypes.ProductCostUpdated)
      .map((e) => e.payload as { productId: string; source: string });
    assert.ok(costEvents.some((p) => p.productId === completeId && p.source === "rollup"));
  });

  it("prefers the variant standard cost override", async () => {
    const w = world();
    const { container, ctx } = w;
    const services = container.services;
    await services.attribute.createDefinition(ctx, {
      code: "grade",
      name: "Grade",
      type: "select",
      options: [
        { code: "std", label: "Standard" },
        { code: "premium", label: "Premium" },
      ],
    });
    const set = await services.attribute.createSet(ctx, {
      name: "Graded",
      members: [{ code: "grade", required: true, isVariantAxis: true }],
    });
    const part = await services.product.create(ctx, {
      code: "GRADED-1",
      name: "Graded part",
      type: "purchased",
      baseUom: "EA",
      attributeSetId: set.id,
    });
    await services.product.setStandardCost(ctx, part.id, { amountMinor: 100, currency: "USD" });
    const premium = await services.product.addVariant(ctx, {
      productId: part.id,
      axisValues: { grade: "premium" },
      standardCost: { amountMinor: 180, currency: "USD" },
    });
    const base = await services.costing.rollUp(ctx, { productId: part.id });
    assert.equal(base.root.unitCost.amountMinor, 100);
    const overridden = await services.costing.rollUp(ctx, { productId: part.id, variantId: premium.id });
    assert.equal(overridden.root.unitCost.amountMinor, 180);
  });

  it("refuses cross-currency rollups instead of mixing money", async () => {
    const w = world();
    const seeded = await seedDemoData(w.container, "demo");
    await expectRejects(
      w.container.services.costing.rollUp(seeded.ctx, {
        productId: seeded.products["DECK-MAPLE"]!,
        currency: "EUR",
      }),
      "INVALID_STATE",
      "no FX conversion",
    );
  });

  it("detects costing cycles defensively", async () => {
    // Repos are bypassed here: build two aggregates that reference each other
    // (the service-level guard normally prevents persisting this shape).
    const { rollUpCost } = await import("../src/domain/costing.js");
    const { Product } = await import("../src/domain/product.js");
    const { Bom } = await import("../src/domain/bom.js");
    const { UomRegistry, uomCode } = await import("../src/domain/uom.js");
    const { tenantId } = await import("@enterprise-suite/shared-kernel");
    const tenant = tenantId("t");
    const ea = uomCode("EA");
    const a = Product.create(tenant, { code: "A-1", name: "A", type: "manufactured", baseUom: ea });
    const b = Product.create(tenant, { code: "B-1", name: "B", type: "manufactured", baseUom: ea });
    const now = new Date().toISOString() as never;
    const bomA = Bom.create(tenant, a.id);
    const draftA = bomA.createDraftRevision();
    bomA.addLine(draftA.id, { componentProductId: b.id, quantity: 1, uom: ea });
    bomA.release(draftA.id, { effectiveFrom: now, releasedBy: "u" as never, at: now });
    const bomB = Bom.create(tenant, b.id);
    const draftB = bomB.createDraftRevision();
    bomB.addLine(draftB.id, { componentProductId: a.id, quantity: 1, uom: ea });
    bomB.release(draftB.id, { effectiveFrom: now, releasedBy: "u" as never, at: now });
    const products = new Map([[a.id, a], [b.id, b]]);
    const boms = new Map([[a.id, bomA], [b.id, bomB]]);
    assert.throws(
      () =>
        rollUpCost(
          {
            productById: (id) => products.get(id),
            bomByProductId: (id) => boms.get(id),
            registry: new UomRegistry(),
          },
          { productId: a.id, at: now, currency: "USD" },
        ),
      /BOM cycle detected/,
    );
  });
});

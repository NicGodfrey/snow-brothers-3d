import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PlmEventTypes } from "../src/domain/events.js";
import { allowedTransitions, canTransition } from "../src/domain/lifecycle.js";
import { expectRejects, world } from "./helpers.js";

async function variantWorld() {
  const w = world();
  const { container, ctx } = w;
  await container.services.attribute.createDefinition(ctx, {
    code: "color",
    name: "Color",
    type: "select",
    options: [
      { code: "black", label: "Black" },
      { code: "red", label: "Red" },
    ],
  });
  const set = await container.services.attribute.createSet(ctx, {
    name: "Colored",
    members: [{ code: "color", required: true, isVariantAxis: true }],
  });
  const product = await container.services.product.create(ctx, {
    code: "WIDGET-1",
    name: "Widget",
    type: "purchased",
    baseUom: "EA",
    attributeSetId: set.id,
  });
  return { w, product };
}

describe("lifecycle state machine", () => {
  it("declares the expected transition graph", () => {
    assert.deepEqual(allowedTransitions("design"), ["pilot"]);
    assert.deepEqual(allowedTransitions("pilot"), ["active", "design"]);
    assert.deepEqual(allowedTransitions("active"), ["end_of_life"]);
    assert.deepEqual(allowedTransitions("end_of_life"), []);
    assert.equal(canTransition("design", "active"), false);
    assert.equal(canTransition("active", "design"), false);
  });
});

describe("product creation", () => {
  it("normalizes code, defaults the SKU and starts in design", async () => {
    const { container, ctx } = world();
    const product = await container.services.product.create(ctx, {
      code: "  gizmo-100 ",
      name: "Gizmo",
      type: "purchased",
      baseUom: "ea",
    });
    assert.equal(product.code, "GIZMO-100");
    assert.equal(product.sku, "GIZMO-100");
    assert.equal(product.lifecycle, "design");
    assert.equal(product.baseUom, "EA");
  });

  it("rejects duplicate codes, unknown units and bad types", async () => {
    const { container, ctx } = world();
    await container.services.product.create(ctx, { code: "DUP-1", name: "A", type: "purchased", baseUom: "EA" });
    await expectRejects(
      container.services.product.create(ctx, { code: "DUP-1", name: "B", type: "purchased", baseUom: "EA" }),
      "CONFLICT",
    );
    await expectRejects(
      container.services.product.create(ctx, { code: "U-1", name: "U", type: "purchased", baseUom: "NOPE" }),
      "UOM_ERROR",
    );
    await expectRejects(
      container.services.product.create(ctx, {
        code: "T-1",
        name: "T",
        type: "imaginary" as never,
        baseUom: "EA",
      }),
      "VALIDATION",
    );
  });

  it("emits a created event through the outbox", async () => {
    const { container, ctx } = world();
    await container.services.product.create(ctx, { code: "EVT-1", name: "E", type: "service", baseUom: "HR" });
    const events = container.outbox.entries(ctx.tenantId).map((e) => e.eventType);
    assert.ok(events.includes(PlmEventTypes.ProductCreated));
  });
});

describe("lifecycle transitions with guards", () => {
  it("walks design -> pilot -> active for a purchased product", async () => {
    const { container, ctx } = world();
    const p = await container.services.product.create(ctx, { code: "LC-1", name: "L", type: "purchased", baseUom: "EA" });
    await container.services.product.transitionLifecycle(ctx, p.id, "pilot");
    const active = await container.services.product.transitionLifecycle(ctx, p.id, "active");
    assert.equal(active.lifecycle, "active");
  });

  it("rejects skipping states and requires a reason for EOL", async () => {
    const { container, ctx } = world();
    const p = await container.services.product.create(ctx, { code: "LC-2", name: "L", type: "purchased", baseUom: "EA" });
    await expectRejects(container.services.product.transitionLifecycle(ctx, p.id, "active"), "INVALID_STATE");
    await container.services.product.transitionLifecycle(ctx, p.id, "pilot");
    await container.services.product.transitionLifecycle(ctx, p.id, "active");
    await expectRejects(container.services.product.transitionLifecycle(ctx, p.id, "end_of_life"), "VALIDATION");
    const eol = await container.services.product.transitionLifecycle(ctx, p.id, "end_of_life", "superseded");
    assert.equal(eol.lifecycle, "end_of_life");
  });

  it("blocks activating a manufactured product without an effective BOM", async () => {
    const { container, ctx, clock } = world();
    const services = container.services;
    const assembly = await services.product.create(ctx, { code: "ASM-1", name: "A", type: "manufactured", baseUom: "EA" });
    const part = await services.product.create(ctx, { code: "PART-1", name: "P", type: "purchased", baseUom: "EA" });
    await services.product.transitionLifecycle(ctx, assembly.id, "pilot");
    await expectRejects(
      services.product.transitionLifecycle(ctx, assembly.id, "active"),
      "INVALID_STATE",
      "released, currently effective BOM",
    );
    const bom = await services.bom.createBom(ctx, assembly.id);
    const draft = bom.draftRevision()!;
    await services.bom.addLine(ctx, assembly.id, draft.id, { componentProductId: part.id, quantity: 2, uom: "EA" });
    await services.bom.releaseRevision(ctx, assembly.id, draft.id, { effectiveFrom: clock.now() });
    const active = await services.product.transitionLifecycle(ctx, assembly.id, "active");
    assert.equal(active.lifecycle, "active");
  });

  it("EOL discontinues all active variants", async () => {
    const { w, product } = await variantWorld();
    const { container, ctx } = w;
    await container.services.product.addVariant(ctx, { productId: product.id, axisValues: { color: "black" } });
    await container.services.product.addVariant(ctx, { productId: product.id, axisValues: { color: "red" } });
    await container.services.product.transitionLifecycle(ctx, product.id, "pilot");
    await container.services.product.transitionLifecycle(ctx, product.id, "active");
    const eol = await container.services.product.transitionLifecycle(ctx, product.id, "end_of_life", "obsolete");
    assert.equal(eol.activeVariants().length, 0);
    assert.ok(eol.variants.every((v) => v.status === "discontinued"));
  });
});

describe("variants and SKUs", () => {
  it("generates deterministic SKUs from axis values", async () => {
    const { w, product } = await variantWorld();
    const variant = await w.container.services.product.addVariant(w.ctx, {
      productId: product.id,
      axisValues: { color: "black" },
    });
    assert.equal(variant.sku, "WIDGET-1-BLACK");
  });

  it("rejects duplicate axis combinations and duplicate SKUs", async () => {
    const { w, product } = await variantWorld();
    const services = w.container.services;
    await services.product.addVariant(w.ctx, { productId: product.id, axisValues: { color: "black" } });
    await expectRejects(
      services.product.addVariant(w.ctx, { productId: product.id, axisValues: { color: "black" } }),
      "INVALID_STATE",
      "already exists",
    );
    await expectRejects(
      services.product.addVariant(w.ctx, {
        productId: product.id,
        axisValues: { color: "red" },
        sku: "WIDGET-1-BLACK",
      }),
      "INVALID_STATE",
      "already used",
    );
  });

  it("validates axis values against the set (missing / unknown / bad option)", async () => {
    const { w, product } = await variantWorld();
    await expectRejects(
      w.container.services.product.addVariant(w.ctx, { productId: product.id, axisValues: {} }),
      "VALIDATION",
    );
    await expectRejects(
      w.container.services.product.addVariant(w.ctx, {
        productId: product.id,
        axisValues: { color: "black", extra: "nope" },
      }),
      "VALIDATION",
    );
    await expectRejects(
      w.container.services.product.addVariant(w.ctx, { productId: product.id, axisValues: { color: "purple" } }),
      "VALIDATION",
    );
  });

  it("enforces tenant-wide SKU uniqueness across products", async () => {
    const { w, product } = await variantWorld();
    const { container, ctx } = w;
    await container.services.product.create(ctx, {
      code: "OTHER-1",
      name: "Other",
      type: "purchased",
      baseUom: "EA",
      sku: "TAKEN-SKU",
    });
    await expectRejects(
      container.services.product.addVariant(ctx, {
        productId: product.id,
        axisValues: { color: "black" },
        sku: "TAKEN-SKU",
      }),
      "CONFLICT",
      "already taken",
    );
  });

  it("resolves base and variant SKUs", async () => {
    const { w, product } = await variantWorld();
    const { container, ctx } = w;
    const variant = await container.services.product.addVariant(ctx, {
      productId: product.id,
      axisValues: { color: "red" },
    });
    const base = await container.services.product.resolveSku(ctx, "WIDGET-1");
    assert.equal(base.product.id, product.id);
    assert.equal(base.variant, undefined);
    const byVariant = await container.services.product.resolveSku(ctx, variant.sku);
    assert.equal(byVariant.variant?.id, variant.id);
    await expectRejects(container.services.product.resolveSku(ctx, "GHOST-SKU"), "NOT_FOUND");
  });

  it("freezes the variant space once the product is active", async () => {
    const { w, product } = await variantWorld();
    const { container, ctx } = w;
    await container.services.product.transitionLifecycle(ctx, product.id, "pilot");
    await container.services.product.transitionLifecycle(ctx, product.id, "active");
    await expectRejects(
      container.services.product.addVariant(ctx, { productId: product.id, axisValues: { color: "red" } }),
      "INVALID_STATE",
      "design/pilot",
    );
  });
});

describe("tenant isolation", () => {
  it("cannot read another tenant's product", async () => {
    const { container, ctx } = world("tenant-a");
    const foreign = { ...ctx, tenantId: "tenant-b" as typeof ctx.tenantId };
    const p = await container.services.product.create(ctx, { code: "ISO-1", name: "I", type: "purchased", baseUom: "EA" });
    await expectRejects(container.services.product.get(foreign, p.id), "NOT_FOUND");
  });
});

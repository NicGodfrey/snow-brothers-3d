import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { axisKey } from "../src/domain/attribute.js";
import { expectRejects, world } from "./helpers.js";

async function schema(w = world()) {
  const { container, ctx } = w;
  const attribute = container.services.attribute;
  await attribute.createDefinition(ctx, {
    code: "color",
    name: "Color",
    type: "select",
    options: [
      { code: "black", label: "Black" },
      { code: "red", label: "Red" },
    ],
  });
  await attribute.createDefinition(ctx, {
    code: "size",
    name: "Size",
    type: "select",
    options: [
      { code: "s", label: "Small" },
      { code: "l", label: "Large" },
    ],
  });
  await attribute.createDefinition(ctx, { code: "weight_g", name: "Weight", type: "number", min: 0, max: 100 });
  await attribute.createDefinition(ctx, {
    code: "cert",
    name: "Certifications",
    type: "multiselect",
    options: [
      { code: "ce", label: "CE" },
      { code: "ul", label: "UL" },
    ],
  });
  await attribute.createDefinition(ctx, { code: "note", name: "Note", type: "text", pattern: "^[A-Z].*" });
  const set = await attribute.createSet(ctx, {
    name: "Gadget",
    members: [
      { code: "color", required: true, isVariantAxis: true },
      { code: "size", required: true, isVariantAxis: true },
      { code: "weight_g", required: true, isVariantAxis: false },
      { code: "cert", required: false, isVariantAxis: false },
      { code: "note", required: false, isVariantAxis: false },
    ],
  });
  return { w, set };
}

describe("attribute definitions and sets", () => {
  it("rejects select attributes without options and bad bounds", async () => {
    const { container, ctx } = world();
    await expectRejects(
      container.services.attribute.createDefinition(ctx, { code: "flavor", name: "Flavor", type: "select" }),
      "VALIDATION",
      "at least one option",
    );
    await expectRejects(
      container.services.attribute.createDefinition(ctx, {
        code: "temp",
        name: "Temp",
        type: "number",
        min: 10,
        max: 1,
      }),
      "VALIDATION",
      "min cannot exceed max",
    );
  });

  it("requires variant axes to be required single-selects", async () => {
    const { container, ctx } = world();
    await container.services.attribute.createDefinition(ctx, { code: "label", name: "Label", type: "text" });
    await expectRejects(
      container.services.attribute.createSet(ctx, {
        name: "Bad",
        members: [{ code: "label", required: true, isVariantAxis: true }],
      }),
      "VALIDATION",
      "single-select",
    );
  });

  it("rejects sets referencing unknown definitions", async () => {
    const { container, ctx } = world();
    await expectRejects(
      container.services.attribute.createSet(ctx, {
        name: "Ghost",
        members: [{ code: "nope", required: false, isVariantAxis: false }],
      }),
      "VALIDATION",
      "does not exist",
    );
  });
});

describe("attribute value validation on products", () => {
  it("accepts a fully valid value map", async () => {
    const { w, set } = await schema();
    const { container, ctx } = w;
    const product = await container.services.product.create(ctx, {
      code: "GADGET-1",
      name: "Gadget",
      type: "purchased",
      baseUom: "EA",
      attributeSetId: set.id,
    });
    const updated = await container.services.product.setAttributes(ctx, product.id, {
      color: "red",
      size: "l",
      weight_g: 42,
      cert: ["ce", "ul"],
      note: "Approved for outdoor use",
    });
    assert.equal(updated.attributes["weight_g"], 42);
  });

  it("collects per-field issues: type errors, unknown options, missing required", async () => {
    const { w, set } = await schema();
    const { container, ctx } = w;
    const product = await container.services.product.create(ctx, {
      code: "GADGET-2",
      name: "Gadget 2",
      type: "purchased",
      baseUom: "EA",
      attributeSetId: set.id,
    });
    try {
      await container.services.product.setAttributes(ctx, product.id, {
        color: "green", // not an option
        size: "l",
        weight_g: 500, // above max
        note: "lowercase start", // violates pattern
        unknown_attr: "x", // not in set
      });
      assert.fail("expected validation error");
    } catch (error) {
      const details = (error as { details?: { issues: { field: string }[] } }).details;
      const fields = details!.issues.map((i) => i.field).sort();
      assert.deepEqual(fields, ["color", "note", "unknown_attr", "weight_g"]);
    }
  });

  it("builds a canonical axis key independent of ordering and case", () => {
    assert.equal(axisKey({ size: "L", color: "Red" }), axisKey({ color: "red", size: "l" }));
    assert.notEqual(axisKey({ color: "red", size: "l" }), axisKey({ color: "red", size: "s" }));
  });
});

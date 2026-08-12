import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { qty, UomRegistry, uomCode } from "../src/domain/uom.js";
import { expectRejects, world } from "./helpers.js";

describe("UomRegistry", () => {
  const registry = new UomRegistry();

  it("converts within a dimension using base factors", () => {
    assert.equal(registry.convert(2.5, "KG", "G"), 2500);
    assert.equal(registry.convert(2500, "G", "KG"), 2.5);
    assert.equal(registry.convert(1, "LB", "G"), 453.59237);
    assert.equal(registry.convert(12, "IN", "FT"), 1);
    assert.equal(registry.convert(90, "MIN", "HR"), 1.5);
  });

  it("respects target unit precision (EA integer, DZ two decimals)", () => {
    assert.equal(registry.convert(2, "DZ", "EA"), 24);
    assert.equal(registry.convert(25, "EA", "DZ"), 2.08);
    assert.equal(registry.convert(2.4, "EA", "EA"), 2, "EA rounds to whole units");
  });

  it("rejects cross-dimension conversion", () => {
    assert.throws(() => registry.convert(1, "KG", "M"), /Cannot convert KG \(mass\) to M \(length\)/);
  });

  it("rejects unknown units and bad codes", () => {
    assert.throws(() => registry.convert(1, "XYZ", "KG"), /Unknown unit of measure/);
    assert.throws(() => uomCode("no spaces allowed"), /Invalid UoM code/);
  });

  it("does quantity math with unit alignment", () => {
    const a = qty(1.5, uomCode("KG"));
    const b = qty(250, uomCode("G"));
    assert.deepEqual(registry.addQty(a, b), qty(1.75, uomCode("KG")));
    assert.deepEqual(registry.scaleQty(b, 3), qty(750, uomCode("G")));
    assert.deepEqual(registry.convertQty(qty(0.5, uomCode("HR")), "MIN"), qty(30, uomCode("MIN")));
  });

  it("rejects duplicate registration and non-positive factors", () => {
    const r = new UomRegistry();
    assert.throws(
      () => r.register({ code: uomCode("EA"), name: "dup", dimension: "count", toBase: 1, precision: 0 }),
      /already registered/,
    );
    assert.throws(
      () => r.register({ code: uomCode("BAD"), name: "bad", dimension: "count", toBase: 0, precision: 0 }),
      /positive base factor/,
    );
  });
});

describe("UomService (tenant-scoped custom units)", () => {
  it("registers a custom unit and converts through it", async () => {
    const { container, ctx } = world();
    await container.services.uom.createUnit(ctx, {
      code: "BOX12",
      name: "Box of 12",
      dimension: "count",
      toBase: 12,
    });
    const converted = await container.services.uom.convert(ctx, { value: 3, from: "BOX12", to: "EA" });
    assert.equal(converted.result, 36);
  });

  it("rejects duplicates against both standard and custom catalogs", async () => {
    const { container, ctx } = world();
    await expectRejects(
      container.services.uom.createUnit(ctx, { code: "EA", name: "Each again", dimension: "count", toBase: 1 }),
      "CONFLICT",
    );
    await container.services.uom.createUnit(ctx, { code: "ROLL", name: "Roll", dimension: "length", toBase: 25 });
    await expectRejects(
      container.services.uom.createUnit(ctx, { code: "ROLL", name: "Roll 2", dimension: "length", toBase: 30 }),
      "CONFLICT",
    );
  });

  it("keeps custom units isolated per tenant", async () => {
    const { container, ctx } = world();
    await container.services.uom.createUnit(ctx, { code: "CRATE", name: "Crate", dimension: "count", toBase: 48 });
    const otherCtx = { ...ctx, tenantId: "other-tenant" as typeof ctx.tenantId };
    await expectRejects(
      container.services.uom.convert(otherCtx, { value: 1, from: "CRATE", to: "EA" }),
      "UOM_ERROR",
      "Unknown unit",
    );
  });
});

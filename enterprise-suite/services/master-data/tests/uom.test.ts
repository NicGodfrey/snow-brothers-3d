import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UomConverter,
  UomRegistry,
  roundToIncrement,
  uomCode,
  type UomConversion,
} from "../src/domain/uom.js";
import { expectRejects, expectThrows, world } from "./helpers.js";

const registry = new UomRegistry();

function conversion(from: string, to: string, factor: number, productCode = "*"): UomConversion {
  return { productCode, from: uomCode(from), to: uomCode(to), factor };
}

describe("dimensional conversion", () => {
  it("converts through the dimension's base unit", () => {
    assert.equal(registry.convert(1, "KG", "G"), 1000);
    assert.equal(registry.convert(1, "KG", "LB"), 2.204623);
    assert.equal(registry.convert(1, "MI", "KM"), 1.609344);
    assert.equal(registry.convert(1, "DZ", "EA"), 12);
  });

  it("applies the offset for affine temperature scales", () => {
    assert.equal(registry.convert(0, "C", "K"), 273.15);
    assert.equal(registry.convert(100, "C", "F"), 212);
    assert.equal(registry.convert(-40, "C", "F"), -40);
  });

  it("refuses a ratio for an affine scale", () => {
    expectThrows(() => registry.ratio("C", "F"), "UOM_ERROR", "affine");
    assert.equal(registry.ratio("KG", "G"), 1000);
  });

  it("will not cross dimensions on its own", () => {
    expectThrows(() => registry.convert(1, "KG", "L"), "UOM_ERROR", "Cannot convert");
  });

  it("rounds to the target unit's precision", () => {
    // EA is a whole-unit count, so a fractional result rounds.
    assert.equal(registry.convert(1.4, "PR", "EA"), 3);
    assert.equal(registry.convert(1, "G", "KG"), 0.001);
  });

  it("adds and compares quantities in mixed units", () => {
    const total = registry.addQty({ value: 1, uom: uomCode("KG") }, { value: 500, uom: uomCode("G") });
    assert.equal(total.value, 1.5);
    assert.equal(String(total.uom), "KG");
    assert.equal(
      registry.compareQty({ value: 1, uom: uomCode("KG") }, { value: 1000, uom: uomCode("G") }),
      0,
    );
  });

  it("rejects unknown and malformed codes", () => {
    expectThrows(() => registry.resolve("NOPE"), "UOM_ERROR", "Unknown unit");
    expectThrows(() => uomCode("kg/l"), "UOM_ERROR", "Invalid UoM code");
  });
});

describe("item conversion", () => {
  it("bridges dimensions through a declared conversion", () => {
    const converter = new UomConverter(registry, [conversion("CASE24", "KG", 7.2)]);
    const extended = new UomRegistry([
      ...registry.all(),
      {
        code: uomCode("CASE24"),
        name: "Case of 24",
        symbol: "case",
        dimension: "count",
        toBase: 24,
        offset: 0,
        precision: 2,
        isStandard: false,
      },
    ]);
    const withUnits = new UomConverter(extended, [conversion("CASE24", "KG", 7.2)]);
    assert.equal(withUnits.convert(2, "CASE24", "KG").value, 14.4);
    // And back again, by inverting the same edge.
    assert.equal(withUnits.convert(14.4, "KG", "CASE24").value, 2);
    // Eaches reach kilograms via CASE24 without a second declaration.
    assert.equal(withUnits.convert(24, "EA", "KG").value, 7.2);
    assert.ok(!converter.canConvert("EA", "KG"));
  });

  it("lets a product-specific edge shadow the catalog-wide one", () => {
    const converter = new UomConverter(registry, [
      conversion("DZ", "KG", 1),
      conversion("DZ", "KG", 3, "HEAVY-PART"),
    ]);
    assert.equal(converter.convert(1, "DZ", "KG").value, 1);
    assert.equal(converter.convert(1, "DZ", "KG", "HEAVY-PART").value, 3);
  });

  it("reports the steps it walked", () => {
    const converter = new UomConverter(registry, [conversion("DZ", "L", 2)]);
    const result = converter.convert(1, "EA", "ML");
    assert.deepEqual(
      result.steps.map((step) => `${step.from}->${step.to}:${step.kind}`),
      ["EA->DZ:dimensional", "DZ->L:item", "L->ML:dimensional"],
    );
    assert.equal(result.value, 166.666667);
  });

  it("never bridges through an affine scale", () => {
    const converter = new UomConverter(registry, [conversion("C", "KG", 2)]);
    expectThrows(() => converter.convert(1, "C", "KG"), "UOM_ERROR", "No conversion");
  });

  it("fails with an actionable message when no path exists", () => {
    const converter = new UomConverter(registry, []);
    expectThrows(
      () => converter.convert(1, "EA", "KG", "WIDGET"),
      "UOM_ERROR",
      "define an item conversion",
    );
  });
});

describe("packaging rounding", () => {
  it("rounds an order quantity onto a multiple", () => {
    assert.equal(roundToIncrement(17, 12, "up"), 24);
    assert.equal(roundToIncrement(17, 12, "down"), 12);
    assert.equal(roundToIncrement(17, 12, "nearest"), 12);
    assert.equal(roundToIncrement(19, 12, "nearest"), 24);
    // An exact multiple is left alone rather than bumped up a pack.
    assert.equal(roundToIncrement(24, 12, "up"), 24);
    expectThrows(() => roundToIncrement(5, 0), "UOM_ERROR", "positive");
  });
});

describe("uom service", () => {
  it("registers a tenant unit and keeps it out of other tenants", async () => {
    const { container, ctx } = world();
    const { uom } = container.services;
    await uom.createUnit(ctx, { code: "roll", name: "Roll of 25 m", dimension: "length", toBase: 25 });
    const unit = await uom.getUnit(ctx, "ROLL");
    assert.equal(unit.toBase, 25);
    assert.equal(unit.isStandard, false);
    assert.equal((await uom.convert(ctx, { value: 2, from: "ROLL", to: "M" })).value, 50);

    const other = world("globex").ctx;
    await expectRejects(uom.getUnit(other, "ROLL"), "NOT_FOUND");
  });

  it("refuses to shadow a standard unit or use a bad factor", async () => {
    const { container, ctx } = world();
    const { uom } = container.services;
    await expectRejects(
      uom.createUnit(ctx, { code: "KG", name: "Kilo", dimension: "mass", toBase: 1 }),
      "CONFLICT",
      "already exists",
    );
    await expectRejects(
      uom.createUnit(ctx, { code: "BAD", name: "Bad", dimension: "mass", toBase: 0 }),
      "VALIDATION",
      "positive",
    );
  });

  it("rejects an item conversion that duplicates the unit catalog", async () => {
    const { container, ctx } = world();
    await expectRejects(
      container.services.uom.defineConversion(ctx, { from: "KG", to: "LB", factor: 2.2 }),
      "UOM_ERROR",
      "already convert through the unit catalog",
    );
  });

  it("defines, uses and removes an item conversion", async () => {
    const { container, ctx } = world();
    const { uom } = container.services;
    await uom.createUnit(ctx, { code: "CASE", name: "Case", dimension: "count", toBase: 24, precision: 2 });
    await uom.defineConversion(ctx, { from: "CASE", to: "KG", factor: 7.2 });

    assert.equal((await uom.convert(ctx, { value: 3, from: "CASE", to: "KG" })).value, 21.6);
    const reachable = await uom.convertibleUnits(ctx, "CASE");
    assert.ok(reachable.some((unit) => String(unit.code) === "LB"));

    await expectRejects(
      uom.defineConversion(ctx, { from: "CASE", to: "KG", factor: 8 }),
      "CONFLICT",
      "already exists",
    );

    await uom.removeConversion(ctx, { from: "CASE", to: "KG" });
    await expectRejects(
      uom.convert(ctx, { value: 3, from: "CASE", to: "KG" }),
      "UOM_ERROR",
      "No conversion",
    );
  });

  it("publishes events for catalog changes", async () => {
    const { container, ctx } = world();
    const { uom } = container.services;
    await uom.createUnit(ctx, { code: "PALLET", name: "Pallet", dimension: "count", toBase: 960 });
    await uom.defineConversion(ctx, { from: "PALLET", to: "KG", factor: 288, productCode: "WIDGET" });
    assert.deepEqual(
      container.outbox.entries(ctx.tenantId).map((event) => event.eventType),
      ["mdm.uom.created", "mdm.uom.conversion-defined"],
    );
  });
});

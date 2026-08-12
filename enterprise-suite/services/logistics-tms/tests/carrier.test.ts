import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeWorld } from "./fixtures.js";

describe("carriers and service levels", () => {
  it("creates a carrier with normalized code and scac", async () => {
    const world = makeWorld();
    const carrier = await world.carriers.createCarrier(world.ctx, {
      code: "swift",
      name: "  Swift Parcel  ",
      mode: "parcel",
      scac: "swft",
    });
    assert.equal(carrier.code, "SWIFT");
    assert.equal(carrier.name, "Swift Parcel");
    assert.equal(carrier.status, "active");
    assert.equal(carrier.toJSON().scac, "SWFT");
  });

  it("enforces unique carrier codes per tenant", async () => {
    const world = makeWorld();
    await world.carriers.createCarrier(world.ctx, { code: "SWIFT", name: "A", mode: "parcel" });
    await assert.rejects(
      () => world.carriers.createCarrier(world.ctx, { code: "swift", name: "B", mode: "ltl" }),
      /already exists/,
    );
  });

  it("allows the same code in different tenants", async () => {
    const worldA = makeWorld("tenant-a");
    await worldA.carriers.createCarrier(worldA.ctx, { code: "SWIFT", name: "A", mode: "parcel" });

    // Second service sharing nothing with the first — new repos
    const worldB = makeWorld("tenant-b");
    const b = await worldB.carriers.createCarrier(worldB.ctx, {
      code: "SWIFT",
      name: "B",
      mode: "parcel",
    });
    assert.equal(b.code, "SWIFT");
  });

  it("validates code, mode, and scac formats", async () => {
    const world = makeWorld();
    await assert.rejects(
      () => world.carriers.createCarrier(world.ctx, { code: "!", name: "X", mode: "parcel" }),
      /carrier\.code/,
    );
    await assert.rejects(
      () =>
        world.carriers.createCarrier(world.ctx, {
          code: "OK",
          name: "X",
          mode: "boat" as never,
        }),
      /parcel\|ltl\|ftl/,
    );
    await assert.rejects(
      () =>
        world.carriers.createCarrier(world.ctx, {
          code: "OK",
          name: "X",
          mode: "parcel",
          scac: "TOOLONG",
        }),
      /scac/,
    );
  });

  it("upserts service levels by code (replace, not duplicate)", async () => {
    const world = makeWorld();
    const carrier = await world.carriers.createCarrier(world.ctx, {
      code: "SWIFT",
      name: "Swift",
      mode: "parcel",
    });
    await world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
      code: "ground",
      name: "Ground",
      transitDays: 3,
      cutoffHour: 17,
      signatureRequired: false,
    });
    const updated = await world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
      code: "GROUND",
      name: "Ground v2",
      transitDays: 2,
      cutoffHour: 18,
      signatureRequired: true,
    });
    assert.equal(updated.serviceLevels.length, 1);
    assert.equal(updated.serviceLevel("GROUND")!.name, "Ground v2");
    assert.equal(updated.serviceLevel("GROUND")!.transitDays, 2);
  });

  it("validates service level bounds", async () => {
    const world = makeWorld();
    const carrier = await world.carriers.createCarrier(world.ctx, {
      code: "SWIFT",
      name: "Swift",
      mode: "parcel",
    });
    await assert.rejects(
      () =>
        world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
          code: "X1",
          name: "Bad",
          transitDays: -1,
          cutoffHour: 17,
          signatureRequired: false,
        }),
      /transitDays/,
    );
    await assert.rejects(
      () =>
        world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
          code: "X1",
          name: "Bad",
          transitDays: 2,
          cutoffHour: 24,
          signatureRequired: false,
        }),
      /cutoffHour/,
    );
  });

  it("removes service levels and 404s on unknown codes", async () => {
    const world = makeWorld();
    const carrier = await world.carriers.createCarrier(world.ctx, {
      code: "SWIFT",
      name: "Swift",
      mode: "parcel",
    });
    await world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
      code: "GROUND",
      name: "Ground",
      transitDays: 3,
      cutoffHour: 17,
      signatureRequired: false,
    });
    await world.carriers.removeServiceLevel(world.ctx, carrier.id, "GROUND");
    const after = await world.carriers.getCarrier(world.ctx, carrier.id);
    assert.equal(after.serviceLevels.length, 0);
    await assert.rejects(
      () => world.carriers.removeServiceLevel(world.ctx, carrier.id, "GROUND"),
      /not found/,
    );
  });

  it("deactivate/activate round-trips and rejects redundant transitions", async () => {
    const world = makeWorld();
    const carrier = await world.carriers.createCarrier(world.ctx, {
      code: "SWIFT",
      name: "Swift",
      mode: "parcel",
    });
    await world.carriers.deactivateCarrier(world.ctx, carrier.id);
    await assert.rejects(
      () => world.carriers.deactivateCarrier(world.ctx, carrier.id),
      /already inactive/,
    );
    await world.carriers.activateCarrier(world.ctx, carrier.id);
    await assert.rejects(
      () => world.carriers.activateCarrier(world.ctx, carrier.id),
      /already active/,
    );
  });

  it("paginates carrier listings", async () => {
    const world = makeWorld();
    for (let i = 0; i < 25; i++) {
      await world.carriers.createCarrier(world.ctx, {
        code: `C${String(i).padStart(2, "0")}`,
        name: `Carrier ${i}`,
        mode: "parcel",
      });
    }
    const page1 = await world.carriers.listCarriers(world.ctx, undefined, { page: 1, pageSize: 10 });
    assert.equal(page1.items.length, 10);
    assert.equal(page1.total, 25);
    assert.equal(page1.nextCursor, "2");
    const page3 = await world.carriers.listCarriers(world.ctx, undefined, { page: 3, pageSize: 10 });
    assert.equal(page3.items.length, 5);
    assert.equal(page3.nextCursor, undefined);
  });
});

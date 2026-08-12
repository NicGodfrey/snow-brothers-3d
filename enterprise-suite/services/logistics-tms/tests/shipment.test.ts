import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LogisticsEvents } from "../src/domain/events.js";
import { Shipment } from "../src/domain/shipment.js";
import {
  BERLIN,
  MUNICH,
  SMALL_BOX,
  makeWorld,
  seedSwiftCarrier,
  type TestWorld,
} from "./fixtures.js";

async function bookedShipment(world: TestWorld) {
  const { carrier } = await seedSwiftCarrier(world);
  const shipment = await world.shipments.createShipment(world.ctx, {
    origin: BERLIN,
    destination: MUNICH,
    orderRef: "SO-1001",
    packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
  });
  const booked = await world.shipments.bookShipment(world.ctx, shipment.id, {
    carrierId: carrier.id,
    serviceLevelCode: "GROUND",
  });
  return { carrier, shipment: booked };
}

describe("shipment lifecycle", () => {
  it("creates a draft with a generated reference and packages", async () => {
    const world = makeWorld();
    const shipment = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 2, dimensions: SMALL_BOX }],
    });
    assert.equal(shipment.status, "draft");
    assert.match(shipment.reference, /^SHP-/);
    assert.equal(shipment.packages.length, 1);
    assert.match(shipment.packages[0]!.reference, /^PKG-/);
  });

  it("books with server-side pricing from the effective rate card", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);

    assert.equal(shipment.status, "booked");
    assert.equal(shipment.serviceLevelCode, "GROUND");
    assert.ok(shipment.trackingNumber!.startsWith("SWIFT"));
    // Munich 80331 hits the DOM-8 zone: 1200 base + 120 fuel
    assert.equal(shipment.cost!.zone, "DOM-8");
    assert.equal(shipment.cost!.totalMinor, 1320);
    assert.equal(shipment.cost!.currency, "EUR");
  });

  it("refuses to book without packages", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);
    const empty = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
    });
    await assert.rejects(
      () =>
        world.shipments.bookShipment(world.ctx, empty.id, {
          carrierId: carrier.id,
          serviceLevelCode: "GROUND",
        }),
      /At least one package/,
    );
  });

  it("refuses to book when no rate is available", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);
    const heavy = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 500, dimensions: SMALL_BOX }],
    });
    await assert.rejects(
      () =>
        world.shipments.bookShipment(world.ctx, heavy.id, {
          carrierId: carrier.id,
          serviceLevelCode: "GROUND",
        }),
      /cannot rate this shipment/,
    );
  });

  it("locks package edits after booking", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);
    await assert.rejects(
      () => world.shipments.addPackage(world.ctx, shipment.id, { weightKg: 1, dimensions: SMALL_BOX }),
      /Cannot add a package/,
    );
  });

  it("advances through the happy-path tracking sequence", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);

    for (const [code, expected] of [
      ["PU", "picked_up"],
      ["DP", "in_transit"],
      ["AR", "in_transit"],
      ["OD", "out_for_delivery"],
      ["DL", "delivered"],
    ] as const) {
      const { shipment: updated } = await world.shipments.recordTrackingEvent(
        world.ctx,
        shipment.id,
        { code },
      );
      assert.equal(updated.status, expected, `after ${code}`);
    }
    const final = await world.shipments.getShipment(world.ctx, shipment.id);
    assert.equal(final.trackingEvents.length, 5);
  });

  it("never regresses status on late or duplicate scans", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);

    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "OD" });
    // A late PU scan arrives afterwards
    const { shipment: updated } = await world.shipments.recordTrackingEvent(
      world.ctx,
      shipment.id,
      { code: "PU" },
    );
    assert.equal(updated.status, "out_for_delivery");
    assert.equal(updated.trackingEvents.length, 2); // both retained in history
  });

  it("flags exceptions without losing progress, and recovers on next scan", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);

    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "PU" });
    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "DP" });
    const { shipment: flagged } = await world.shipments.recordTrackingEvent(
      world.ctx,
      shipment.id,
      { code: "EX", description: "Address unreadable" },
    );
    assert.equal(flagged.status, "exception");

    // A repeat in-transit scan clears the exception back to in_transit
    const { shipment: recovered } = await world.shipments.recordTrackingEvent(
      world.ctx,
      shipment.id,
      { code: "AR" },
    );
    assert.equal(recovered.status, "in_transit");

    // And progress continues normally
    const { shipment: delivered } = await world.shipments.recordTrackingEvent(
      world.ctx,
      shipment.id,
      { code: "DL" },
    );
    assert.equal(delivered.status, "delivered");
  });

  it("rejects tracking on drafts and cancelled shipments", async () => {
    const world = makeWorld();
    const draft = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 1, dimensions: SMALL_BOX }],
    });
    await assert.rejects(
      () => world.shipments.recordTrackingEvent(world.ctx, draft.id, { code: "PU" }),
      /before booking/,
    );

    await world.shipments.cancelShipment(world.ctx, draft.id, "customer changed mind");
    await assert.rejects(
      () => world.shipments.recordTrackingEvent(world.ctx, draft.id, { code: "PU" }),
      /cancelled/,
    );
  });

  it("only allows NT notes after delivery", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);
    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "DL" });

    await assert.rejects(
      () => world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "PU" }),
      /already delivered/,
    );
    const { shipment: withNote } = await world.shipments.recordTrackingEvent(
      world.ctx,
      shipment.id,
      { code: "NT", description: "Left at reception per instructions" },
    );
    assert.equal(withNote.status, "delivered");
  });

  it("allows cancellation only before pickup", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);
    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "PU" });
    await assert.rejects(
      () => world.shipments.cancelShipment(world.ctx, shipment.id, "too late"),
      /Cannot cancel/,
    );
  });

  it("emits booked, tracking, and delivered events via the outbox", async () => {
    const world = makeWorld();
    const { shipment } = await bookedShipment(world);
    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "DL" });

    const types = world.outbox.pending().map((r) => r.envelope.eventType);
    assert.ok(types.includes(LogisticsEvents.ShipmentCreated));
    assert.ok(types.includes(LogisticsEvents.ShipmentBooked));
    assert.ok(types.includes(LogisticsEvents.ShipmentTrackingUpdated));
    assert.ok(types.includes(LogisticsEvents.ShipmentDelivered));

    const delivered = world.outbox
      .pending()
      .find((r) => r.envelope.eventType === LogisticsEvents.ShipmentDelivered);
    assert.equal((delivered!.envelope.payload as { orderRef?: string }).orderRef, "SO-1001");
  });

  it("validates addresses at creation", () => {
    const world = makeWorld();
    assert.rejects(
      () =>
        world.shipments.createShipment(world.ctx, {
          origin: { ...BERLIN, country: "GERMANY" },
          destination: MUNICH,
        }),
      /ISO 3166-1 alpha-2/,
    );
  });

  it("isolates shipments between tenants", async () => {
    const worldA = makeWorld("tenant-a");
    const shipment = await worldA.shipments.createShipment(worldA.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 1, dimensions: SMALL_BOX }],
    });

    const worldBCtx = makeWorld("tenant-b").ctx;
    // Same repo instance, different tenant → not found
    const found = await worldA.shipmentRepo.findById(worldBCtx.tenantId, shipment.id);
    assert.equal(found, undefined);
  });
});

describe("shipment domain guards", () => {
  it("rejects unknown tracking codes at the domain boundary", () => {
    const world = makeWorld();
    const shipment = Shipment.create(world.ctx.tenantId, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 1, dimensions: SMALL_BOX }],
    });
    assert.throws(
      () => shipment.recordTrackingEvent({ code: "ZZ" as never }),
      /Unknown tracking code/,
    );
  });

  it("rejects negative and non-finite package weights", () => {
    const world = makeWorld();
    assert.throws(
      () =>
        Shipment.create(world.ctx.tenantId, {
          origin: BERLIN,
          destination: MUNICH,
          packages: [{ weightKg: -1, dimensions: SMALL_BOX }],
        }),
      /weightKg must be a positive number/,
    );
  });
});

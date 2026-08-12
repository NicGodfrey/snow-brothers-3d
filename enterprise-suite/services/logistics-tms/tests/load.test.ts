import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Ulid } from "@enterprise-suite/shared-kernel";
import { LogisticsEvents } from "../src/domain/events.js";
import {
  BERLIN,
  MUNICH,
  SMALL_BOX,
  makeWorld,
  seedSwiftCarrier,
  type TestWorld,
} from "./fixtures.js";

/** Load with pickup (seq 1) and delivery (seq 2) stops plus one booked shipment. */
async function plannedLoad(world: TestWorld) {
  const { carrier } = await seedSwiftCarrier(world);
  const shipment = await world.shipments.createShipment(world.ctx, {
    origin: BERLIN,
    destination: MUNICH,
    packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
  });
  await world.shipments.bookShipment(world.ctx, shipment.id, {
    carrierId: carrier.id,
    serviceLevelCode: "GROUND",
  });

  let load = await world.loads.createLoad(world.ctx, { mode: "ftl", carrierId: carrier.id });
  load = await world.loads.addStop(world.ctx, load.id, {
    sequence: 1,
    type: "pickup",
    facilityName: "Berlin DC",
    address: BERLIN,
  });
  load = await world.loads.addStop(world.ctx, load.id, {
    sequence: 2,
    type: "delivery",
    facilityName: "Munich Hub",
    address: MUNICH,
  });
  const pickupStop = load.stops[0]!;
  const deliveryStop = load.stops[1]!;
  load = await world.loads.assignShipment(world.ctx, load.id, {
    shipmentId: shipment.id,
    pickupStopId: pickupStop.stopId,
    deliveryStopId: deliveryStop.stopId,
  });
  return { carrier, shipment, load, pickupStop, deliveryStop };
}

describe("load planning", () => {
  it("rejects duplicate stop sequences", async () => {
    const world = makeWorld();
    const load = await world.loads.createLoad(world.ctx, { mode: "ftl" });
    await world.loads.addStop(world.ctx, load.id, {
      sequence: 1,
      type: "pickup",
      facilityName: "A",
      address: BERLIN,
    });
    await assert.rejects(
      () =>
        world.loads.addStop(world.ctx, load.id, {
          sequence: 1,
          type: "delivery",
          facilityName: "B",
          address: MUNICH,
        }),
      /sequence 1 already exists/,
    );
  });

  it("requires pickup before delivery in the stop order", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);
    const shipment = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 1, dimensions: SMALL_BOX }],
    });
    await world.shipments.bookShipment(world.ctx, shipment.id, {
      carrierId: carrier.id,
      serviceLevelCode: "GROUND",
    });

    let load = await world.loads.createLoad(world.ctx, { mode: "ftl", carrierId: carrier.id });
    load = await world.loads.addStop(world.ctx, load.id, {
      sequence: 1,
      type: "delivery",
      facilityName: "Munich Hub",
      address: MUNICH,
    });
    load = await world.loads.addStop(world.ctx, load.id, {
      sequence: 2,
      type: "pickup",
      facilityName: "Berlin DC",
      address: BERLIN,
    });
    await assert.rejects(
      () =>
        world.loads.assignShipment(world.ctx, load.id, {
          shipmentId: shipment.id,
          pickupStopId: load.stops[1]!.stopId, // seq 2 pickup
          deliveryStopId: load.stops[0]!.stopId, // seq 1 delivery
        }),
      /Pickup \(seq 2\) must come before delivery \(seq 1\)/,
    );
  });

  it("rejects assigning draft shipments to a load", async () => {
    const world = makeWorld();
    const { load } = await plannedLoad(world);
    const draft = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 1, dimensions: SMALL_BOX }],
    });
    await assert.rejects(
      () =>
        world.loads.assignShipment(world.ctx, load.id, {
          shipmentId: draft.id,
          pickupStopId: load.stops[0]!.stopId,
          deliveryStopId: load.stops[1]!.stopId,
        }),
      /must be booked/,
    );
  });

  it("refuses to remove a stop that assignments still reference", async () => {
    const world = makeWorld();
    const { load, pickupStop } = await plannedLoad(world);
    await assert.rejects(
      () => world.loads.removeStop(world.ctx, load.id, pickupStop.stopId),
      /referenced by shipment assignments/,
    );
  });

  it("blocks dispatch without carrier, stops, or shipments", async () => {
    const world = makeWorld();
    const bare = await world.loads.createLoad(world.ctx, { mode: "ftl" });
    await assert.rejects(() => world.loads.dispatch(world.ctx, bare.id), /without a carrier/);

    const { carrier } = await seedSwiftCarrier(world);
    const withCarrier = await world.loads.createLoad(world.ctx, {
      mode: "ftl",
      carrierId: carrier.id,
    });
    await assert.rejects(
      () => world.loads.dispatch(world.ctx, withCarrier.id),
      /fewer than 2 stops/,
    );
  });
});

describe("load execution", () => {
  it("dispatches and emits the load.dispatched event", async () => {
    const world = makeWorld();
    const { load, shipment } = await plannedLoad(world);
    const dispatched = await world.loads.dispatch(world.ctx, load.id);
    assert.equal(dispatched.status, "dispatched");

    const evt = world.outbox
      .pending()
      .find((r) => r.envelope.eventType === LogisticsEvents.LoadDispatched);
    assert.ok(evt);
    const payload = evt.envelope.payload as { shipmentIds: Ulid[] };
    assert.deepEqual(payload.shipmentIds, [shipment.id]);
  });

  it("enforces stop visiting order", async () => {
    const world = makeWorld();
    const { load, deliveryStop } = await plannedLoad(world);
    await world.loads.dispatch(world.ctx, load.id);
    await assert.rejects(
      () => world.loads.recordStopArrival(world.ctx, load.id, deliveryStop.stopId),
      /earlier stop\(s\) 1 not yet visited/,
    );
  });

  it("pushes PU tracking to shipments when departing their pickup stop", async () => {
    const world = makeWorld();
    const { load, shipment, pickupStop } = await plannedLoad(world);
    await world.loads.dispatch(world.ctx, load.id);
    await world.loads.recordStopArrival(world.ctx, load.id, pickupStop.stopId);
    await world.loads.recordStopDeparture(world.ctx, load.id, pickupStop.stopId);

    const updated = await world.shipments.getShipment(world.ctx, shipment.id);
    assert.equal(updated.status, "picked_up");
    assert.equal(updated.trackingEvents[0]!.code, "PU");
    assert.match(updated.trackingEvents[0]!.description, /Berlin DC/);
  });

  it("pushes AR tracking to shipments on arrival at their delivery stop", async () => {
    const world = makeWorld();
    const { load, shipment, pickupStop, deliveryStop } = await plannedLoad(world);
    await world.loads.dispatch(world.ctx, load.id);
    await world.loads.recordStopArrival(world.ctx, load.id, pickupStop.stopId);
    await world.loads.recordStopDeparture(world.ctx, load.id, pickupStop.stopId);
    await world.loads.recordStopArrival(world.ctx, load.id, deliveryStop.stopId);

    const updated = await world.shipments.getShipment(world.ctx, shipment.id);
    assert.equal(updated.status, "in_transit");
    assert.equal(updated.trackingEvents.length, 2);
    assert.equal(updated.trackingEvents[1]!.code, "AR");
  });

  it("cannot depart a stop before arriving, nor complete with unvisited stops", async () => {
    const world = makeWorld();
    const { load, pickupStop, deliveryStop } = await plannedLoad(world);
    await world.loads.dispatch(world.ctx, load.id);

    await assert.rejects(
      () => world.loads.recordStopDeparture(world.ctx, load.id, pickupStop.stopId),
      /Cannot record a departure on a load in status 'dispatched'/,
    );

    await world.loads.recordStopArrival(world.ctx, load.id, pickupStop.stopId);
    await assert.rejects(() => world.loads.complete(world.ctx, load.id), /stop\(s\) 2 not visited/);

    await world.loads.recordStopDeparture(world.ctx, load.id, pickupStop.stopId);
    await world.loads.recordStopArrival(world.ctx, load.id, deliveryStop.stopId);
    const completed = await world.loads.complete(world.ctx, load.id);
    assert.equal(completed.status, "completed");
  });

  it("freezes planning operations after dispatch", async () => {
    const world = makeWorld();
    const { load } = await plannedLoad(world);
    await world.loads.dispatch(world.ctx, load.id);
    await assert.rejects(
      () =>
        world.loads.addStop(world.ctx, load.id, {
          sequence: 3,
          type: "delivery",
          facilityName: "Extra",
          address: MUNICH,
        }),
      /Cannot add a stop to a load in status 'dispatched'/,
    );
  });
});

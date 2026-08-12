import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LogisticsEvents } from "../src/domain/events.js";
import {
  BERLIN,
  MUNICH,
  SMALL_BOX,
  makeWorld,
  seedSwiftCarrier,
  type TestWorld,
} from "./fixtures.js";

async function shipmentOutForDelivery(world: TestWorld) {
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
  await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "PU" });
  await world.shipments.recordTrackingEvent(world.ctx, shipment.id, { code: "OD" });
  return shipment;
}

describe("proof of delivery", () => {
  it("captures a POD, delivers the shipment, and links the two", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);

    const { pod, shipment: delivered } = await world.pods.capture(world.ctx, shipment.id, {
      signedBy: "H. Müller",
      method: "signature",
      documentUri: "s3://pods/sig-123.png",
    });

    assert.equal(delivered.status, "delivered");
    assert.equal(delivered.podId, pod.id);
    assert.equal(pod.shipmentId, shipment.id);
    assert.equal(pod.signedBy, "H. Müller");

    // The DL tracking event carries the signer
    const last = delivered.trackingEvents[delivered.trackingEvents.length - 1]!;
    assert.equal(last.code, "DL");
    assert.match(last.description, /signed by H\. Müller/);

    // Retrievable by shipment
    const fetched = await world.pods.getByShipment(world.ctx, shipment.id);
    assert.equal(fetched.id, pod.id);
  });

  it("records delivery exceptions on the POD", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);

    const { pod } = await world.pods.capture(world.ctx, shipment.id, {
      signedBy: "Front Desk",
      receiverRole: "front_desk",
      method: "photo",
      exceptions: [
        { code: "damaged", description: "Corner crushed", packageRef: shipment.packages[0]!.reference },
      ],
    });
    assert.ok(pod.hasExceptions());
    assert.equal(pod.exceptions[0]!.code, "damaged");

    // Concealed damage found later
    await world.pods.noteException(world.ctx, pod.id, {
      code: "shortage",
      description: "One unit missing from carton",
    });
    const updated = await world.pods.getByShipment(world.ctx, shipment.id);
    assert.equal(updated.exceptions.length, 2);
  });

  it("allows exactly one POD per shipment", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);
    await world.pods.capture(world.ctx, shipment.id, { signedBy: "A", method: "pin" });
    await assert.rejects(
      () => world.pods.capture(world.ctx, shipment.id, { signedBy: "B", method: "pin" }),
      /already has a proof of delivery/,
    );
  });

  it("rejects capture for shipments that are not in motion", async () => {
    const world = makeWorld();
    const draft = await world.shipments.createShipment(world.ctx, {
      origin: BERLIN,
      destination: MUNICH,
      packages: [{ weightKg: 1, dimensions: SMALL_BOX }],
    });
    await assert.rejects(
      () => world.pods.capture(world.ctx, draft.id, { signedBy: "X", method: "signature" }),
      /status 'draft'/,
    );
  });

  it("allows capture from an exception state (recovered delivery)", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);
    await world.shipments.recordTrackingEvent(world.ctx, shipment.id, {
      code: "EX",
      description: "Receiver absent",
    });

    const { shipment: delivered } = await world.pods.capture(world.ctx, shipment.id, {
      signedBy: "Neighbor",
      receiverRole: "neighbor",
      method: "signature",
    });
    assert.equal(delivered.status, "delivered");
  });

  it("rejects future-dated capture timestamps", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await assert.rejects(
      () =>
        world.pods.capture(world.ctx, shipment.id, {
          signedBy: "X",
          method: "signature",
          capturedAt: future,
        }),
      /cannot be in the future/,
    );
  });

  it("emits pod.captured and shipment.delivered through the outbox", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);
    await world.pods.capture(world.ctx, shipment.id, { signedBy: "X", method: "signature" });

    const types = world.outbox.pending().map((r) => r.envelope.eventType);
    assert.ok(types.includes(LogisticsEvents.PodCaptured));
    assert.ok(types.includes(LogisticsEvents.ShipmentDelivered));
  });

  it("drains the outbox exactly once per event", async () => {
    const world = makeWorld();
    const shipment = await shipmentOutForDelivery(world);
    await world.pods.capture(world.ctx, shipment.id, { signedBy: "X", method: "signature" });

    const seen: string[] = [];
    const first = await world.outbox.drain((e) => {
      seen.push(e.eventType);
    });
    assert.ok(first.published > 0);
    assert.equal(first.failed, 0);

    const second = await world.outbox.drain((e) => {
      seen.push(e.eventType);
    });
    assert.equal(second.published, 0);
    assert.equal(world.outbox.pending().length, 0);
  });

  it("keeps failed publishes retryable without blocking others", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    let calls = 0;
    const result = await world.outbox.drain(() => {
      calls += 1;
      if (calls === 1) throw new Error("bus unavailable");
    });
    assert.equal(result.failed, 1);
    assert.ok(result.published >= 1); // later records still went out

    assert.equal(world.outbox.retryFailed(), 1);
    const retry = await world.outbox.drain(() => {});
    assert.equal(retry.published, 1);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billablePackageWeightKg, billableShipmentWeightKg } from "../src/domain/rating.js";
import { LogisticsEvents } from "../src/domain/events.js";
import {
  BERLIN,
  BULKY_BOX,
  MUNICH,
  PARIS,
  SMALL_BOX,
  makeWorld,
  seedSwiftCarrier,
} from "./fixtures.js";

describe("billable weight", () => {
  it("uses actual weight when it exceeds dimensional weight", () => {
    // 30*20*10 = 6000cm3 / 5000 = 1.2kg dimensional; actual 4kg wins
    const kg = billablePackageWeightKg({ weightKg: 4, dimensions: SMALL_BOX }, 5000);
    assert.equal(kg, 4);
  });

  it("uses dimensional weight for bulky light packages, rounded up to 0.5kg", () => {
    // 100*80*75 = 600000cm3 / 5000 = 120kg dimensional vs 2kg actual
    const kg = billablePackageWeightKg({ weightKg: 2, dimensions: BULKY_BOX }, 5000);
    assert.equal(kg, 120);
  });

  it("rounds up to the next half kilo", () => {
    // 30*20*10 = 6000 / 4000 = 1.5 dim; actual 1.26 → dim wins at 1.5
    assert.equal(billablePackageWeightKg({ weightKg: 1.26, dimensions: SMALL_BOX }, 4000), 1.5);
    // no dims: 1.26 actual → 1.5
    assert.equal(billablePackageWeightKg({ weightKg: 1.26 }, 5000), 1.5);
  });

  it("sums per-package billable weights across the shipment", () => {
    const total = billableShipmentWeightKg(
      [
        { weightKg: 1.2, dimensions: SMALL_BOX },
        { weightKg: 3.4, dimensions: SMALL_BOX },
      ],
      5000,
    );
    // 1.5 + 3.5
    assert.equal(total, 5);
  });

  it("rejects an empty package list", () => {
    assert.throws(() => billableShipmentWeightKg([], 5000), /At least one package/);
  });
});

describe("rate shopping", () => {
  it("quotes base + fuel for a domestic shipment", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
    });

    assert.equal(quotes.length, 1);
    const q = quotes[0]!;
    assert.equal(q.carrierCode, "SWIFT");
    assert.equal(q.serviceLevelCode, "GROUND");
    assert.equal(q.zone, "DOM");
    assert.equal(q.billableWeightKg, 4);
    assert.equal(q.baseMinor, 1000); // ≤5kg break
    assert.equal(q.fuelMinor, 100); // 10%
    assert.equal(q.accessorialsMinor, 0);
    assert.equal(q.totalMinor, 1100);
  });

  it("prefers the most specific postal-prefix zone rule", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: MUNICH, // postal 80331 matches prefix '8'
      packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
    });

    assert.equal(quotes[0]!.zone, "DOM-8");
    assert.equal(quotes[0]!.baseMinor, 1200);
  });

  it("selects the correct weight break", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 18, dimensions: SMALL_BOX }],
    });
    assert.equal(quotes[0]!.baseMinor, 2500); // ≤20kg break
  });

  it("adds accessorial fees and lists which were applied", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
      accessorialCodes: ["LIFTGATE", "RESIDENTIAL"],
    });
    const q = quotes[0]!;
    assert.equal(q.accessorialsMinor, 800);
    assert.deepEqual([...q.appliedAccessorials], ["LIFTGATE", "RESIDENTIAL"]);
    assert.equal(q.totalMinor, 1000 + 100 + 800);
  });

  it("skips carriers that do not offer a requested accessorial", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
      accessorialCodes: ["HAZMAT"],
    });
    assert.equal(quotes.length, 0);
  });

  it("returns no quotes when weight exceeds every break", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: PARIS, // EU-1 tops out at 20kg
      packages: [{ weightKg: 50, dimensions: SMALL_BOX }],
    });
    assert.equal(quotes.length, 0);
  });

  it("returns no quotes for unserved destinations", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);

    const quotes = await world.rating.quote(world.ctx, {
      destination: { ...PARIS, country: "US", postalCode: "10001" },
      packages: [{ weightKg: 1 }],
    });
    assert.equal(quotes.length, 0);
  });

  it("excludes inactive carriers from shopping", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);
    await world.carriers.deactivateCarrier(world.ctx, carrier.id);

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4 }],
    });
    assert.equal(quotes.length, 0);
  });

  it("ignores draft and not-yet-effective rate cards", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);

    // EXPRESS card exists but stays draft → not rateable
    const draft = await world.rateCards.createRateCard(world.ctx, {
      carrierId: carrier.id,
      serviceLevelCode: "EXPRESS",
      currency: "EUR",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
    });
    await world.rateCards.addZoneRule(world.ctx, draft.id, { zone: "DOM", country: "DE" });
    await world.rateCards.addBreak(world.ctx, draft.id, {
      zone: "DOM",
      maxWeightKg: 50,
      amountMinor: 3000,
    });
    // not published

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4 }],
    });
    assert.equal(quotes.length, 1);
    assert.equal(quotes[0]!.serviceLevelCode, "GROUND");
  });

  it("sorts quotes cheapest first, ties broken by transit days", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);

    // Publish an EXPRESS card that is more expensive
    const express = await world.rateCards.createRateCard(world.ctx, {
      carrierId: carrier.id,
      serviceLevelCode: "EXPRESS",
      currency: "EUR",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
      fuelSurchargePct: 10,
    });
    await world.rateCards.addZoneRule(world.ctx, express.id, { zone: "DOM", country: "DE" });
    await world.rateCards.addBreak(world.ctx, express.id, {
      zone: "DOM",
      maxWeightKg: 100,
      amountMinor: 5000,
    });
    await world.rateCards.publish(world.ctx, express.id);

    const quotes = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4, dimensions: SMALL_BOX }],
    });
    assert.equal(quotes.length, 2);
    assert.equal(quotes[0]!.serviceLevelCode, "GROUND");
    assert.equal(quotes[1]!.serviceLevelCode, "EXPRESS");
    assert.ok(quotes[0]!.totalMinor <= quotes[1]!.totalMinor);
  });

  it("respects rate card effectivity windows via shipDate", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);

    // Archive-dated card: effective only during 2021
    const legacy = await world.rateCards.createRateCard(world.ctx, {
      carrierId: carrier.id,
      serviceLevelCode: "EXPRESS",
      currency: "EUR",
      effectiveFrom: "2021-01-01T00:00:00.000Z",
      effectiveTo: "2021-12-31T23:59:59.000Z",
    });
    await world.rateCards.addZoneRule(world.ctx, legacy.id, { zone: "DOM", country: "DE" });
    await world.rateCards.addBreak(world.ctx, legacy.id, {
      zone: "DOM",
      maxWeightKg: 100,
      amountMinor: 100,
    });
    await world.rateCards.publish(world.ctx, legacy.id);

    const during = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4 }],
      shipDate: "2021-06-01T00:00:00.000Z",
    });
    assert.ok(during.some((q) => q.serviceLevelCode === "EXPRESS"));

    const after = await world.rating.quote(world.ctx, {
      destination: BERLIN,
      packages: [{ weightKg: 4 }],
      shipDate: "2023-06-01T00:00:00.000Z",
    });
    assert.ok(!after.some((q) => q.serviceLevelCode === "EXPRESS"));
  });
});

describe("rate card publishing rules", () => {
  it("refuses to publish with zones lacking breaks", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);
    const card = await world.rateCards.createRateCard(world.ctx, {
      carrierId: carrier.id,
      serviceLevelCode: "EXPRESS",
      currency: "EUR",
      effectiveFrom: "2020-01-01T00:00:00.000Z",
    });
    await world.rateCards.addZoneRule(world.ctx, card.id, { zone: "DOM", country: "DE" });
    await world.rateCards.addZoneRule(world.ctx, card.id, { zone: "EU-1", country: "FR" });
    await world.rateCards.addBreak(world.ctx, card.id, {
      zone: "DOM",
      maxWeightKg: 10,
      amountMinor: 900,
    });
    await assert.rejects(
      () => world.rateCards.publish(world.ctx, card.id),
      /Zones without rate breaks: EU-1/,
    );
  });

  it("locks the card against edits after publishing", async () => {
    const world = makeWorld();
    const { rateCard } = await seedSwiftCarrier(world);
    await assert.rejects(
      () =>
        world.rateCards.addBreak(world.ctx, rateCard.id, {
          zone: "DOM",
          maxWeightKg: 200,
          amountMinor: 20000,
        }),
      /rate card is published/,
    );
  });

  it("rejects rate cards for service levels the carrier does not offer", async () => {
    const world = makeWorld();
    const { carrier } = await seedSwiftCarrier(world);
    await assert.rejects(
      () =>
        world.rateCards.createRateCard(world.ctx, {
          carrierId: carrier.id,
          serviceLevelCode: "FREIGHT",
          currency: "EUR",
          effectiveFrom: "2020-01-01T00:00:00.000Z",
        }),
      /does not offer service level/,
    );
  });

  it("emits a published event through the outbox", async () => {
    const world = makeWorld();
    await seedSwiftCarrier(world);
    const types = world.outbox.pending().map((r) => r.envelope.eventType);
    assert.ok(types.includes(LogisticsEvents.RateCardPublished));
    assert.ok(types.includes(LogisticsEvents.CarrierCreated));
  });
});

import { createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import { CarrierService } from "../src/application/carrier-service.js";
import { DockSchedulingService } from "../src/application/dock-scheduling-service.js";
import { LoadService } from "../src/application/load-service.js";
import { PodService } from "../src/application/pod-service.js";
import { RateCardService } from "../src/application/rate-card-service.js";
import { RatingService } from "../src/application/rating-service.js";
import { ShipmentService } from "../src/application/shipment-service.js";
import type { Carrier } from "../src/domain/carrier.js";
import type { RateCard } from "../src/domain/rate-card.js";
import type { Address, Dimensions } from "../src/domain/values.js";
import {
  InMemoryCarrierRepository,
  InMemoryDockAppointmentRepository,
  InMemoryLoadRepository,
  InMemoryProofOfDeliveryRepository,
  InMemoryRateCardRepository,
  InMemoryShipmentRepository,
} from "../src/infrastructure/in-memory.js";
import { InMemoryOutbox } from "../src/infrastructure/outbox.js";

export interface TestWorld {
  readonly ctx: TenantContext;
  readonly outbox: InMemoryOutbox;
  readonly carrierRepo: InMemoryCarrierRepository;
  readonly rateCardRepo: InMemoryRateCardRepository;
  readonly shipmentRepo: InMemoryShipmentRepository;
  readonly loadRepo: InMemoryLoadRepository;
  readonly dockRepo: InMemoryDockAppointmentRepository;
  readonly podRepo: InMemoryProofOfDeliveryRepository;
  readonly carriers: CarrierService;
  readonly rateCards: RateCardService;
  readonly rating: RatingService;
  readonly shipments: ShipmentService;
  readonly loads: LoadService;
  readonly docks: DockSchedulingService;
  readonly pods: PodService;
}

export function makeWorld(tenant = "acme"): TestWorld {
  const ctx = createTenantContext(tenant, "user-1", ["ops"]);
  const outbox = new InMemoryOutbox();
  const carrierRepo = new InMemoryCarrierRepository();
  const rateCardRepo = new InMemoryRateCardRepository();
  const shipmentRepo = new InMemoryShipmentRepository();
  const loadRepo = new InMemoryLoadRepository();
  const dockRepo = new InMemoryDockAppointmentRepository();
  const podRepo = new InMemoryProofOfDeliveryRepository();

  const carriers = new CarrierService(carrierRepo, outbox);
  const rateCards = new RateCardService(rateCardRepo, carrierRepo, outbox);
  const rating = new RatingService(carrierRepo, rateCardRepo);
  const shipments = new ShipmentService(shipmentRepo, rating, outbox);
  const loads = new LoadService(loadRepo, shipmentRepo, carrierRepo, outbox);
  const docks = new DockSchedulingService(dockRepo, outbox);
  const pods = new PodService(podRepo, shipmentRepo, outbox);

  return {
    ctx,
    outbox,
    carrierRepo,
    rateCardRepo,
    shipmentRepo,
    loadRepo,
    dockRepo,
    podRepo,
    carriers,
    rateCards,
    rating,
    shipments,
    loads,
    docks,
    pods,
  };
}

export const BERLIN: Address = {
  name: "Acme Warehouse Berlin",
  line1: "Lagerstrasse 1",
  city: "Berlin",
  postalCode: "10115",
  country: "DE",
};

export const MUNICH: Address = {
  name: "Kunde GmbH",
  line1: "Kaufingerstrasse 12",
  city: "Munich",
  region: "BY",
  postalCode: "80331",
  country: "DE",
};

export const PARIS: Address = {
  name: "Client SARL",
  line1: "10 Rue de Rivoli",
  city: "Paris",
  postalCode: "75001",
  country: "FR",
};

export const SMALL_BOX: Dimensions = { lengthCm: 30, widthCm: 20, heightCm: 10 };
export const BULKY_BOX: Dimensions = { lengthCm: 100, widthCm: 80, heightCm: 75 };

/**
 * Standard carrier setup used across suites: parcel carrier "SWIFT" with
 * GROUND + EXPRESS service levels and a published EUR rate card.
 *
 * Zones:   DOM  = DE (any postal), DOM-8 = DE postal 8* (more specific)
 *          EU-1 = FR
 * Breaks:  DOM:   ≤5kg 1000, ≤20kg 2500, ≤100kg 9000
 *          DOM-8: ≤5kg 1200, ≤20kg 2800, ≤100kg 9500
 *          EU-1:  ≤5kg 2000, ≤20kg 4500
 * Fuel:    10%   Accessorials: LIFTGATE 500, RESIDENTIAL 300
 */
export async function seedSwiftCarrier(world: TestWorld): Promise<{
  carrier: Carrier;
  rateCard: RateCard;
}> {
  const carrier = await world.carriers.createCarrier(world.ctx, {
    code: "SWIFT",
    name: "Swift Parcel",
    mode: "parcel",
  });
  await world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
    code: "GROUND",
    name: "Swift Ground",
    transitDays: 3,
    cutoffHour: 17,
    signatureRequired: false,
  });
  await world.carriers.upsertServiceLevel(world.ctx, carrier.id, {
    code: "EXPRESS",
    name: "Swift Express",
    transitDays: 1,
    cutoffHour: 15,
    signatureRequired: true,
  });

  const rateCard = await world.rateCards.createRateCard(world.ctx, {
    carrierId: carrier.id,
    serviceLevelCode: "GROUND",
    currency: "EUR",
    effectiveFrom: "2020-01-01T00:00:00.000Z",
    fuelSurchargePct: 10,
  });
  await world.rateCards.addZoneRule(world.ctx, rateCard.id, { zone: "DOM", country: "DE" });
  await world.rateCards.addZoneRule(world.ctx, rateCard.id, {
    zone: "DOM-8",
    country: "DE",
    postalPrefix: "8",
  });
  await world.rateCards.addZoneRule(world.ctx, rateCard.id, { zone: "EU-1", country: "FR" });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "DOM", maxWeightKg: 5, amountMinor: 1000 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "DOM", maxWeightKg: 20, amountMinor: 2500 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "DOM", maxWeightKg: 100, amountMinor: 9000 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "DOM-8", maxWeightKg: 5, amountMinor: 1200 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "DOM-8", maxWeightKg: 20, amountMinor: 2800 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "DOM-8", maxWeightKg: 100, amountMinor: 9500 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "EU-1", maxWeightKg: 5, amountMinor: 2000 });
  await world.rateCards.addBreak(world.ctx, rateCard.id, { zone: "EU-1", maxWeightKg: 20, amountMinor: 4500 });
  await world.rateCards.upsertAccessorial(world.ctx, rateCard.id, {
    code: "LIFTGATE",
    name: "Liftgate delivery",
    amountMinor: 500,
  });
  await world.rateCards.upsertAccessorial(world.ctx, rateCard.id, {
    code: "RESIDENTIAL",
    name: "Residential delivery",
    amountMinor: 300,
  });
  await world.rateCards.publish(world.ctx, rateCard.id);

  return { carrier, rateCard };
}

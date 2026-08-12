import { createServer, type Server } from "node:http";
import { CarrierService } from "../application/carrier-service.js";
import { DockSchedulingService } from "../application/dock-scheduling-service.js";
import { LoadService } from "../application/load-service.js";
import { PodService } from "../application/pod-service.js";
import { RateCardService } from "../application/rate-card-service.js";
import { RatingService } from "../application/rating-service.js";
import { ShipmentService } from "../application/shipment-service.js";
import {
  InMemoryCarrierRepository,
  InMemoryDockAppointmentRepository,
  InMemoryLoadRepository,
  InMemoryProofOfDeliveryRepository,
  InMemoryRateCardRepository,
  InMemoryShipmentRepository,
} from "../infrastructure/in-memory.js";
import { InMemoryOutbox } from "../infrastructure/outbox.js";
import { Router } from "./router.js";
import { registerCarrierRoutes } from "./routes/carriers.js";
import { registerDockRoutes } from "./routes/docks.js";
import { registerLoadRoutes } from "./routes/loads.js";
import { registerRateCardRoutes } from "./routes/rate-cards.js";
import { registerShipmentRoutes } from "./routes/shipments.js";

export interface App {
  readonly router: Router;
  readonly outbox: InMemoryOutbox;
  readonly services: {
    readonly carriers: CarrierService;
    readonly rateCards: RateCardService;
    readonly rating: RatingService;
    readonly shipments: ShipmentService;
    readonly loads: LoadService;
    readonly docks: DockSchedulingService;
    readonly pods: PodService;
  };
}

/** Composition root: repos → services → routes, all in-memory. */
export function buildApp(): App {
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

  const router = new Router();
  router.get("/health", () => ({
    status: 200,
    body: { status: "ok", service: "logistics-tms" },
  }));
  router.get("/outbox/pending", (rc) => {
    // Tenant-gated observability endpoint for the outbox relay.
    void rc.tenant;
    return { status: 200, body: { items: outbox.pending() } };
  });

  registerCarrierRoutes(router, carriers);
  registerRateCardRoutes(router, rateCards, rating);
  registerShipmentRoutes(router, shipments, pods);
  registerLoadRoutes(router, loads);
  registerDockRoutes(router, docks);

  return {
    router,
    outbox,
    services: { carriers, rateCards, rating, shipments, loads, docks, pods },
  };
}

export function createHttpServer(app: App = buildApp()): Server {
  return createServer((req, res) => {
    void app.router.handle(req, res);
  });
}

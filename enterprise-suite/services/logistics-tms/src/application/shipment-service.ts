import {
  NotFoundError,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  Shipment,
  type CreateShipmentInput,
  type PackageInput,
  type ShipmentStatus,
  type TrackingCode,
  type TrackingEvent,
} from "../domain/shipment.js";
import type { OutboxPort } from "../infrastructure/outbox.js";
import type { ShipmentRepository } from "../infrastructure/repositories.js";
import type { RatingService } from "./rating-service.js";

export class ShipmentService {
  constructor(
    private readonly shipments: ShipmentRepository,
    private readonly rating: RatingService,
    private readonly outbox: OutboxPort,
  ) {}

  async createShipment(ctx: TenantContext, input: CreateShipmentInput): Promise<Shipment> {
    const shipment = Shipment.create(ctx.tenantId, input);
    await this.shipments.save(shipment);
    this.outbox.enqueue(shipment.pullEvents());
    return shipment;
  }

  async addPackage(ctx: TenantContext, shipmentId: Ulid, pkg: PackageInput): Promise<Shipment> {
    const shipment = await this.requireShipment(ctx, shipmentId);
    shipment.addPackage(pkg);
    await this.shipments.save(shipment);
    return shipment;
  }

  async removePackage(ctx: TenantContext, shipmentId: Ulid, packageId: Ulid): Promise<Shipment> {
    const shipment = await this.requireShipment(ctx, shipmentId);
    shipment.removePackage(packageId);
    await this.shipments.save(shipment);
    return shipment;
  }

  /**
   * Books the shipment with a specific carrier + service level. The price
   * is computed server-side from the effective rate card at booking time —
   * clients never supply their own cost.
   */
  async bookShipment(
    ctx: TenantContext,
    shipmentId: Ulid,
    input: {
      carrierId: Ulid;
      serviceLevelCode: string;
      trackingNumber?: string;
      shipDate?: string;
    },
  ): Promise<Shipment> {
    const shipment = await this.requireShipment(ctx, shipmentId);
    const quote = await this.rating.quoteFor(ctx, {
      carrierId: input.carrierId,
      serviceLevelCode: input.serviceLevelCode,
      destination: shipment.destination,
      packages: shipment.packages,
      accessorialCodes: shipment.requestedAccessorials,
      shipDate: input.shipDate,
    });
    shipment.book({
      carrierId: quote.carrierId,
      carrierCode: quote.carrierCode,
      serviceLevelCode: quote.serviceLevelCode,
      trackingNumber: input.trackingNumber,
      cost: {
        rateCardId: quote.rateCardId,
        currency: quote.currency,
        zone: quote.zone,
        billableWeightKg: quote.billableWeightKg,
        baseMinor: quote.baseMinor,
        fuelMinor: quote.fuelMinor,
        accessorialsMinor: quote.accessorialsMinor,
        totalMinor: quote.totalMinor,
      },
    });
    await this.shipments.save(shipment);
    this.outbox.enqueue(shipment.pullEvents());
    return shipment;
  }

  async recordTrackingEvent(
    ctx: TenantContext,
    shipmentId: Ulid,
    input: { code: TrackingCode; description?: string; location?: string; occurredAt?: string },
  ): Promise<{ shipment: Shipment; event: TrackingEvent }> {
    const shipment = await this.requireShipment(ctx, shipmentId);
    const event = shipment.recordTrackingEvent(input);
    await this.shipments.save(shipment);
    this.outbox.enqueue(shipment.pullEvents());
    return { shipment, event };
  }

  async cancelShipment(ctx: TenantContext, shipmentId: Ulid, reason: string): Promise<Shipment> {
    const shipment = await this.requireShipment(ctx, shipmentId);
    shipment.cancel(reason);
    await this.shipments.save(shipment);
    this.outbox.enqueue(shipment.pullEvents());
    return shipment;
  }

  async getShipment(ctx: TenantContext, shipmentId: Ulid): Promise<Shipment> {
    return this.requireShipment(ctx, shipmentId);
  }

  async getByTrackingNumber(ctx: TenantContext, trackingNumber: string): Promise<Shipment> {
    const shipment = await this.shipments.findByTrackingNumber(ctx.tenantId, trackingNumber);
    if (shipment === undefined) {
      throw new NotFoundError("Shipment", trackingNumber);
    }
    return shipment;
  }

  async listShipments(
    ctx: TenantContext,
    filter?: { status?: ShipmentStatus; carrierId?: Ulid; orderRef?: string },
    page?: Partial<PageRequest>,
  ): Promise<Page<Shipment>> {
    const items = await this.shipments.list(ctx.tenantId, filter);
    return paginate(items, normalizePage(page));
  }

  private async requireShipment(ctx: TenantContext, shipmentId: Ulid): Promise<Shipment> {
    const shipment = await this.shipments.findById(ctx.tenantId, shipmentId);
    if (shipment === undefined) {
      throw new NotFoundError("Shipment", shipmentId);
    }
    return shipment;
  }
}

import {
  ConflictError,
  NotFoundError,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { Load, type AddStopInput, type LoadMode, type LoadStatus } from "../domain/load.js";
import type { OutboxPort } from "../infrastructure/outbox.js";
import type {
  CarrierRepository,
  LoadRepository,
  ShipmentRepository,
} from "../infrastructure/repositories.js";

export class LoadService {
  constructor(
    private readonly loads: LoadRepository,
    private readonly shipments: ShipmentRepository,
    private readonly carriers: CarrierRepository,
    private readonly outbox: OutboxPort,
  ) {}

  async createLoad(
    ctx: TenantContext,
    input: {
      reference?: string;
      mode: LoadMode;
      carrierId?: Ulid;
      driverName?: string;
      vehicleRef?: string;
      plannedDistanceKm?: number;
    },
  ): Promise<Load> {
    if (input.carrierId !== undefined) {
      await this.requireActiveCarrier(ctx, input.carrierId);
    }
    const load = Load.create(ctx.tenantId, input);
    await this.loads.save(load);
    this.outbox.enqueue(load.pullEvents());
    return load;
  }

  async assignCarrier(ctx: TenantContext, loadId: Ulid, carrierId: Ulid): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    await this.requireActiveCarrier(ctx, carrierId);
    load.assignCarrier(carrierId);
    await this.loads.save(load);
    return load;
  }

  async assignDriver(
    ctx: TenantContext,
    loadId: Ulid,
    input: { driverName?: string; vehicleRef?: string },
  ): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.assignDriver(input);
    await this.loads.save(load);
    return load;
  }

  async addStop(ctx: TenantContext, loadId: Ulid, input: AddStopInput): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.addStop(input);
    await this.loads.save(load);
    return load;
  }

  async removeStop(ctx: TenantContext, loadId: Ulid, stopId: Ulid): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.removeStop(stopId);
    await this.loads.save(load);
    return load;
  }

  /**
   * Routes a booked shipment onto a load. Draft and terminal shipments
   * cannot ride a load — drafts have no carrier commitment yet, and
   * delivered/cancelled shipments are done moving.
   */
  async assignShipment(
    ctx: TenantContext,
    loadId: Ulid,
    input: { shipmentId: Ulid; pickupStopId: Ulid; deliveryStopId: Ulid },
  ): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    const shipment = await this.shipments.findById(ctx.tenantId, input.shipmentId);
    if (shipment === undefined) {
      throw new NotFoundError("Shipment", input.shipmentId);
    }
    if (shipment.status === "draft") {
      throw new ConflictError(
        `Shipment ${shipment.reference} must be booked before it can be loaded`,
      );
    }
    if (shipment.isTerminal()) {
      throw new ConflictError(
        `Shipment ${shipment.reference} is ${shipment.status} and cannot be loaded`,
      );
    }
    load.assignShipment(input);
    await this.loads.save(load);
    return load;
  }

  async unassignShipment(ctx: TenantContext, loadId: Ulid, shipmentId: Ulid): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.unassignShipment(shipmentId);
    await this.loads.save(load);
    return load;
  }

  async dispatch(ctx: TenantContext, loadId: Ulid): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.dispatch();
    await this.loads.save(load);
    this.outbox.enqueue(load.pullEvents());
    return load;
  }

  /**
   * Records arrival at a stop. Arriving at a delivery stop pushes an AR
   * ("arrived at delivery location") tracking event to each shipment being
   * delivered there, keeping shipment tracking in sync with load execution.
   */
  async recordStopArrival(
    ctx: TenantContext,
    loadId: Ulid,
    stopId: Ulid,
    at?: string,
  ): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    const stop = load.recordStopArrival(stopId, at);
    await this.loads.save(load);
    this.outbox.enqueue(load.pullEvents());

    if (stop.type === "delivery") {
      for (const shipmentId of load.shipmentsDeliveredAt(stopId)) {
        const shipment = await this.shipments.findById(ctx.tenantId, shipmentId);
        if (shipment === undefined || shipment.isTerminal()) continue;
        shipment.recordTrackingEvent({
          code: "AR",
          description: `Arrived at ${stop.facilityName}`,
          location: `${stop.address.city}, ${stop.address.country}`,
          occurredAt: stop.arrivedAt,
        });
        await this.shipments.save(shipment);
        this.outbox.enqueue(shipment.pullEvents());
      }
    }
    return load;
  }

  /**
   * Records departure from a stop. Departing a pickup stop generates a PU
   * tracking event for every shipment picked up there — the moment freight
   * physically starts moving.
   */
  async recordStopDeparture(
    ctx: TenantContext,
    loadId: Ulid,
    stopId: Ulid,
    at?: string,
  ): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    const stop = load.recordStopDeparture(stopId, at);
    await this.loads.save(load);
    this.outbox.enqueue(load.pullEvents());

    if (stop.type === "pickup") {
      for (const shipmentId of load.shipmentsPickedUpAt(stopId)) {
        const shipment = await this.shipments.findById(ctx.tenantId, shipmentId);
        if (shipment === undefined || shipment.isTerminal()) continue;
        shipment.recordTrackingEvent({
          code: "PU",
          description: `Picked up at ${stop.facilityName}`,
          location: `${stop.address.city}, ${stop.address.country}`,
          occurredAt: stop.departedAt,
        });
        await this.shipments.save(shipment);
        this.outbox.enqueue(shipment.pullEvents());
      }
    }
    return load;
  }

  async complete(ctx: TenantContext, loadId: Ulid): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.complete();
    await this.loads.save(load);
    this.outbox.enqueue(load.pullEvents());
    return load;
  }

  async cancel(ctx: TenantContext, loadId: Ulid, reason: string): Promise<Load> {
    const load = await this.requireLoad(ctx, loadId);
    load.cancel(reason);
    await this.loads.save(load);
    this.outbox.enqueue(load.pullEvents());
    return load;
  }

  async getLoad(ctx: TenantContext, loadId: Ulid): Promise<Load> {
    return this.requireLoad(ctx, loadId);
  }

  async listLoads(
    ctx: TenantContext,
    filter?: { status?: LoadStatus; carrierId?: Ulid },
    page?: Partial<PageRequest>,
  ): Promise<Page<Load>> {
    const items = await this.loads.list(ctx.tenantId, filter);
    return paginate(items, normalizePage(page));
  }

  private async requireLoad(ctx: TenantContext, loadId: Ulid): Promise<Load> {
    const load = await this.loads.findById(ctx.tenantId, loadId);
    if (load === undefined) {
      throw new NotFoundError("Load", loadId);
    }
    return load;
  }

  private async requireActiveCarrier(ctx: TenantContext, carrierId: Ulid): Promise<void> {
    const carrier = await this.carriers.findById(ctx.tenantId, carrierId);
    if (carrier === undefined) {
      throw new NotFoundError("Carrier", carrierId);
    }
    if (!carrier.isActive()) {
      throw new ConflictError(`Carrier ${carrier.code} is inactive`);
    }
  }
}

import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { Carrier } from "../domain/carrier.js";
import type { DockAppointment } from "../domain/dock-appointment.js";
import type { Load, LoadStatus } from "../domain/load.js";
import type { ProofOfDelivery } from "../domain/proof-of-delivery.js";
import type { RateCard } from "../domain/rate-card.js";
import type { Shipment, ShipmentStatus } from "../domain/shipment.js";
import type { TransportMode } from "../domain/values.js";
import type {
  CarrierRepository,
  DockAppointmentRepository,
  LoadRepository,
  ProofOfDeliveryRepository,
  RateCardRepository,
  ShipmentRepository,
} from "./repositories.js";

/**
 * Tenant-partitioned in-memory store. Keys are `${tenantId}:${id}` so a
 * lookup with the wrong tenant can never observe another tenant's data.
 */
abstract class TenantScopedStore<T extends { id: Ulid; tenantId: TenantId }> {
  protected readonly byKey = new Map<string, T>();

  protected key(tenantId: TenantId, id: Ulid): string {
    return `${tenantId}:${id}`;
  }

  async findById(tenantId: TenantId, id: Ulid): Promise<T | undefined> {
    return this.byKey.get(this.key(tenantId, id));
  }

  async save(aggregate: T): Promise<void> {
    this.byKey.set(this.key(aggregate.tenantId, aggregate.id), aggregate);
  }

  protected values(tenantId: TenantId): T[] {
    const prefix = `${tenantId}:`;
    const result: T[] = [];
    for (const [key, value] of this.byKey) {
      if (key.startsWith(prefix)) result.push(value);
    }
    return result;
  }
}

export class InMemoryCarrierRepository
  extends TenantScopedStore<Carrier>
  implements CarrierRepository
{
  async findByCode(tenantId: TenantId, code: string): Promise<Carrier | undefined> {
    const upper = code.toUpperCase();
    return this.values(tenantId).find((c) => c.code === upper);
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: string; mode?: TransportMode },
  ): Promise<Carrier[]> {
    return this.values(tenantId)
      .filter((c) => filter?.status === undefined || c.status === filter.status)
      .filter((c) => filter?.mode === undefined || c.mode === filter.mode)
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryRateCardRepository
  extends TenantScopedStore<RateCard>
  implements RateCardRepository
{
  async listByCarrier(tenantId: TenantId, carrierId: Ulid): Promise<RateCard[]> {
    return this.values(tenantId)
      .filter((rc) => rc.carrierId === carrierId)
      .sort((a, b) => a.serviceLevelCode.localeCompare(b.serviceLevelCode));
  }

  async findEffective(
    tenantId: TenantId,
    carrierId: Ulid,
    serviceLevelCode: string,
    atIso: string,
  ): Promise<RateCard[]> {
    const upper = serviceLevelCode.toUpperCase();
    return this.values(tenantId)
      .filter(
        (rc) =>
          rc.carrierId === carrierId &&
          rc.serviceLevelCode === upper &&
          rc.isEffectiveOn(atIso),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class InMemoryShipmentRepository
  extends TenantScopedStore<Shipment>
  implements ShipmentRepository
{
  async findByReference(tenantId: TenantId, reference: string): Promise<Shipment | undefined> {
    return this.values(tenantId).find((s) => s.reference === reference);
  }

  async findByTrackingNumber(
    tenantId: TenantId,
    trackingNumber: string,
  ): Promise<Shipment | undefined> {
    return this.values(tenantId).find((s) => s.trackingNumber === trackingNumber);
  }

  async list(
    tenantId: TenantId,
    filter?: { status?: ShipmentStatus; carrierId?: Ulid; orderRef?: string },
  ): Promise<Shipment[]> {
    return this.values(tenantId)
      .filter((s) => filter?.status === undefined || s.status === filter.status)
      .filter((s) => filter?.carrierId === undefined || s.carrierId === filter.carrierId)
      .filter((s) => filter?.orderRef === undefined || s.orderRef === filter.orderRef)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class InMemoryLoadRepository extends TenantScopedStore<Load> implements LoadRepository {
  async list(
    tenantId: TenantId,
    filter?: { status?: LoadStatus; carrierId?: Ulid },
  ): Promise<Load[]> {
    return this.values(tenantId)
      .filter((l) => filter?.status === undefined || l.status === filter.status)
      .filter((l) => filter?.carrierId === undefined || l.carrierId === filter.carrierId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

export class InMemoryDockAppointmentRepository
  extends TenantScopedStore<DockAppointment>
  implements DockAppointmentRepository
{
  async listByDoor(
    tenantId: TenantId,
    facilityCode: string,
    dockDoor: string,
  ): Promise<DockAppointment[]> {
    const facility = facilityCode.toUpperCase();
    const door = dockDoor.toUpperCase();
    return this.values(tenantId).filter(
      (a) => a.facilityCode === facility && a.dockDoor === door,
    );
  }

  async list(
    tenantId: TenantId,
    filter?: { facilityCode?: string; status?: string; dateIso?: string },
  ): Promise<DockAppointment[]> {
    let items = this.values(tenantId);
    if (filter?.facilityCode !== undefined) {
      const facility = filter.facilityCode.toUpperCase();
      items = items.filter((a) => a.facilityCode === facility);
    }
    if (filter?.status !== undefined) {
      items = items.filter((a) => a.status === filter.status);
    }
    if (filter?.dateIso !== undefined) {
      const day = filter.dateIso.slice(0, 10);
      items = items.filter((a) => a.windowStart.slice(0, 10) === day);
    }
    return items.sort((a, b) => a.windowStart.localeCompare(b.windowStart));
  }
}

export class InMemoryProofOfDeliveryRepository
  extends TenantScopedStore<ProofOfDelivery>
  implements ProofOfDeliveryRepository
{
  async findByShipmentId(
    tenantId: TenantId,
    shipmentId: Ulid,
  ): Promise<ProofOfDelivery | undefined> {
    return this.values(tenantId).find((p) => p.shipmentId === shipmentId);
  }
}

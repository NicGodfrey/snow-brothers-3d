import type { TenantId, Ulid } from "@enterprise-suite/shared-kernel";
import type { Carrier } from "../domain/carrier.js";
import type { DockAppointment } from "../domain/dock-appointment.js";
import type { Load, LoadStatus } from "../domain/load.js";
import type { ProofOfDelivery } from "../domain/proof-of-delivery.js";
import type { RateCard } from "../domain/rate-card.js";
import type { Shipment, ShipmentStatus } from "../domain/shipment.js";
import type { TransportMode } from "../domain/values.js";

/**
 * Repository ports. All lookups are tenant-scoped; implementations must
 * never leak aggregates across tenants. The in-memory implementations in
 * `in-memory.ts` satisfy these; a Postgres adapter can replace them without
 * touching the application layer (see `migrations/` for the schema).
 */

export interface CarrierRepository {
  findById(tenantId: TenantId, id: Ulid): Promise<Carrier | undefined>;
  findByCode(tenantId: TenantId, code: string): Promise<Carrier | undefined>;
  list(
    tenantId: TenantId,
    filter?: { status?: string; mode?: TransportMode },
  ): Promise<Carrier[]>;
  save(carrier: Carrier): Promise<void>;
}

export interface RateCardRepository {
  findById(tenantId: TenantId, id: Ulid): Promise<RateCard | undefined>;
  listByCarrier(tenantId: TenantId, carrierId: Ulid): Promise<RateCard[]>;
  /**
   * All published cards for a carrier+service level effective at the given
   * instant. Callers pick the newest when several overlap.
   */
  findEffective(
    tenantId: TenantId,
    carrierId: Ulid,
    serviceLevelCode: string,
    atIso: string,
  ): Promise<RateCard[]>;
  save(rateCard: RateCard): Promise<void>;
}

export interface ShipmentRepository {
  findById(tenantId: TenantId, id: Ulid): Promise<Shipment | undefined>;
  findByReference(tenantId: TenantId, reference: string): Promise<Shipment | undefined>;
  findByTrackingNumber(tenantId: TenantId, trackingNumber: string): Promise<Shipment | undefined>;
  list(
    tenantId: TenantId,
    filter?: { status?: ShipmentStatus; carrierId?: Ulid; orderRef?: string },
  ): Promise<Shipment[]>;
  save(shipment: Shipment): Promise<void>;
}

export interface LoadRepository {
  findById(tenantId: TenantId, id: Ulid): Promise<Load | undefined>;
  list(tenantId: TenantId, filter?: { status?: LoadStatus; carrierId?: Ulid }): Promise<Load[]>;
  save(load: Load): Promise<void>;
}

export interface DockAppointmentRepository {
  findById(tenantId: TenantId, id: Ulid): Promise<DockAppointment | undefined>;
  /** Appointments on one door, used for overlap checks. */
  listByDoor(
    tenantId: TenantId,
    facilityCode: string,
    dockDoor: string,
  ): Promise<DockAppointment[]>;
  list(
    tenantId: TenantId,
    filter?: { facilityCode?: string; status?: string; dateIso?: string },
  ): Promise<DockAppointment[]>;
  save(appointment: DockAppointment): Promise<void>;
}

export interface ProofOfDeliveryRepository {
  findById(tenantId: TenantId, id: Ulid): Promise<ProofOfDelivery | undefined>;
  findByShipmentId(tenantId: TenantId, shipmentId: Ulid): Promise<ProofOfDelivery | undefined>;
  save(pod: ProofOfDelivery): Promise<void>;
}

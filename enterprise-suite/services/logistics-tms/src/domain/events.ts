import type { Ulid } from "@enterprise-suite/shared-kernel";

/**
 * Event catalog for the logistics-tms bounded context.
 *
 * All events are published through the transactional outbox as
 * shared-kernel `EventEnvelope`s. Other contexts (inventory, sales,
 * finance, reporting) subscribe by `eventType`.
 */
export const LogisticsEvents = {
  CarrierCreated: "logistics.carrier.created",
  CarrierUpdated: "logistics.carrier.updated",
  CarrierActivated: "logistics.carrier.activated",
  CarrierDeactivated: "logistics.carrier.deactivated",
  CarrierServiceLevelUpserted: "logistics.carrier.service_level_upserted",
  CarrierServiceLevelRemoved: "logistics.carrier.service_level_removed",

  RateCardCreated: "logistics.rate_card.created",
  RateCardPublished: "logistics.rate_card.published",
  RateCardArchived: "logistics.rate_card.archived",

  ShipmentCreated: "logistics.shipment.created",
  ShipmentBooked: "logistics.shipment.booked",
  ShipmentTrackingUpdated: "logistics.shipment.tracking_updated",
  ShipmentException: "logistics.shipment.exception",
  ShipmentDelivered: "logistics.shipment.delivered",
  ShipmentCancelled: "logistics.shipment.cancelled",

  LoadCreated: "logistics.load.created",
  LoadDispatched: "logistics.load.dispatched",
  LoadStopArrived: "logistics.load.stop_arrived",
  LoadStopDeparted: "logistics.load.stop_departed",
  LoadCompleted: "logistics.load.completed",
  LoadCancelled: "logistics.load.cancelled",

  DockAppointmentRequested: "logistics.dock_appointment.requested",
  DockAppointmentConfirmed: "logistics.dock_appointment.confirmed",
  DockAppointmentRescheduled: "logistics.dock_appointment.rescheduled",
  DockAppointmentCheckedIn: "logistics.dock_appointment.checked_in",
  DockAppointmentCompleted: "logistics.dock_appointment.completed",
  DockAppointmentCancelled: "logistics.dock_appointment.cancelled",
  DockAppointmentNoShow: "logistics.dock_appointment.no_show",

  PodCaptured: "logistics.pod.captured",
  PodExceptionNoted: "logistics.pod.exception_noted",
} as const;

export type LogisticsEventType = (typeof LogisticsEvents)[keyof typeof LogisticsEvents];

// ---------------------------------------------------------------------------
// Payload shapes for the most integration-relevant events. Consumers should
// treat unknown fields as forward-compatible additions.
// ---------------------------------------------------------------------------

export interface CarrierCreatedPayload {
  readonly carrierId: Ulid;
  readonly code: string;
  readonly name: string;
  readonly mode: string;
}

export interface RateCardPublishedPayload {
  readonly rateCardId: Ulid;
  readonly carrierId: Ulid;
  readonly serviceLevelCode: string;
  readonly currency: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

export interface ShipmentBookedPayload {
  readonly shipmentId: Ulid;
  readonly reference: string;
  readonly orderRef?: string;
  readonly carrierId: Ulid;
  readonly carrierCode: string;
  readonly serviceLevelCode: string;
  readonly trackingNumber: string;
  readonly totalMinor: number;
  readonly currency: string;
}

export interface ShipmentTrackingUpdatedPayload {
  readonly shipmentId: Ulid;
  readonly trackingNumber?: string;
  readonly code: string;
  readonly status: string;
  readonly occurredAt: string;
  readonly location?: string;
}

export interface ShipmentDeliveredPayload {
  readonly shipmentId: Ulid;
  readonly reference: string;
  readonly orderRef?: string;
  readonly deliveredAt: string;
}

export interface LoadDispatchedPayload {
  readonly loadId: Ulid;
  readonly reference: string;
  readonly carrierId: Ulid;
  readonly shipmentIds: readonly Ulid[];
  readonly stopCount: number;
}

export interface DockAppointmentConfirmedPayload {
  readonly appointmentId: Ulid;
  readonly facilityCode: string;
  readonly dockDoor: string;
  readonly windowStart: string;
  readonly windowEnd: string;
}

export interface PodCapturedPayload {
  readonly podId: Ulid;
  readonly shipmentId: Ulid;
  readonly signedBy: string;
  readonly method: string;
  readonly capturedAt: string;
  readonly exceptionCount: number;
}

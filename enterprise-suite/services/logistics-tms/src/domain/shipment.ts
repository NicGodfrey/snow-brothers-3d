import {
  AggregateRoot,
  ConflictError,
  DomainError,
  NotFoundError,
  envelope,
  newId,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  LogisticsEvents,
  type ShipmentBookedPayload,
  type ShipmentDeliveredPayload,
  type ShipmentTrackingUpdatedPayload,
} from "./events.js";
import {
  assertIsoDateTime,
  assertPositiveNumber,
  documentReference,
  validateAddress,
  validateDimensions,
  type Address,
  type Dimensions,
} from "./values.js";

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

export type ShipmentStatus =
  | "draft"
  | "booked"
  | "picked_up"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception"
  | "cancelled";

/**
 * Rank of each progress status. Tracking events can only move a shipment
 * forward through these ranks; late or duplicated scans are recorded in
 * history but never regress the status. `exception` and `cancelled` sit
 * outside the linear progression.
 */
const PROGRESS_RANK: Record<string, number> = {
  draft: 0,
  booked: 1,
  picked_up: 2,
  in_transit: 3,
  out_for_delivery: 4,
  delivered: 5,
};

// ---------------------------------------------------------------------------
// Tracking events
// ---------------------------------------------------------------------------

/** Standard tracking event codes (EDI 214-inspired). */
export type TrackingCode = "PU" | "DP" | "AR" | "OD" | "DL" | "EX" | "NT";

export const TRACKING_CODES: readonly TrackingCode[] = [
  "PU",
  "DP",
  "AR",
  "OD",
  "DL",
  "EX",
  "NT",
];

/** Status each code drives the shipment toward. NT is informational only. */
const CODE_TO_STATUS: Record<TrackingCode, ShipmentStatus | undefined> = {
  PU: "picked_up",
  DP: "in_transit",
  AR: "in_transit",
  OD: "out_for_delivery",
  DL: "delivered",
  EX: "exception",
  NT: undefined,
};

const CODE_DESCRIPTION: Record<TrackingCode, string> = {
  PU: "Picked up",
  DP: "Departed facility",
  AR: "Arrived at facility",
  OD: "Out for delivery",
  DL: "Delivered",
  EX: "Delivery exception",
  NT: "Carrier note",
};

export interface TrackingEvent {
  readonly trackingEventId: Ulid;
  readonly code: TrackingCode;
  readonly description: string;
  readonly location?: string;
  readonly occurredAt: IsoDateTime;
  readonly recordedAt: IsoDateTime;
}

// ---------------------------------------------------------------------------
// Packages & cost
// ---------------------------------------------------------------------------

export interface PackageLine {
  readonly packageId: Ulid;
  readonly reference: string;
  readonly weightKg: number;
  readonly dimensions: Dimensions;
  readonly declaredValueMinor?: number;
}

export interface PackageInput {
  readonly reference?: string;
  readonly weightKg: number;
  readonly dimensions: Dimensions;
  readonly declaredValueMinor?: number;
}

/** Cost breakdown captured at booking time from the winning rate quote. */
export interface ShipmentCost {
  readonly rateCardId: Ulid;
  readonly currency: string;
  readonly zone: string;
  readonly billableWeightKg: number;
  readonly baseMinor: number;
  readonly fuelMinor: number;
  readonly accessorialsMinor: number;
  readonly totalMinor: number;
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface ShipmentProps {
  reference: string;
  /** Upstream sales-order reference, when the shipment fulfils an order. */
  orderRef?: string;
  origin: Address;
  destination: Address;
  packages: PackageLine[];
  status: ShipmentStatus;
  /** Furthest progress rank reached; exceptions do not reset it. */
  progressRank: number;
  carrierId?: Ulid;
  carrierCode?: string;
  serviceLevelCode?: string;
  trackingNumber?: string;
  cost?: ShipmentCost;
  requestedAccessorials: string[];
  trackingEvents: TrackingEvent[];
  podId?: Ulid;
  cancelReason?: string;
}

export interface CreateShipmentInput {
  readonly reference?: string;
  readonly orderRef?: string;
  readonly origin: Address;
  readonly destination: Address;
  readonly packages?: readonly PackageInput[];
  readonly accessorialCodes?: readonly string[];
}

function validatePackage(input: PackageInput): PackageLine {
  assertPositiveNumber(input.weightKg, "package.weightKg");
  if (input.weightKg > 30000) {
    throw new DomainError("package.weightKg exceeds the 30,000kg limit", "VALIDATION");
  }
  validateDimensions(input.dimensions, "package.dimensions");
  if (input.declaredValueMinor !== undefined) {
    if (!Number.isInteger(input.declaredValueMinor) || input.declaredValueMinor < 0) {
      throw new DomainError(
        "package.declaredValueMinor must be a non-negative integer",
        "VALIDATION",
      );
    }
  }
  return {
    packageId: newId("pkg"),
    reference: input.reference?.trim() || documentReference("PKG"),
    weightKg: input.weightKg,
    dimensions: input.dimensions,
    declaredValueMinor: input.declaredValueMinor,
  };
}

export class Shipment extends AggregateRoot<ShipmentProps> {
  private constructor(tenantId: TenantId, props: ShipmentProps) {
    super(tenantId, props);
  }

  static create(tenantId: TenantId, input: CreateShipmentInput): Shipment {
    const origin = validateAddress(input.origin, "origin");
    const destination = validateAddress(input.destination, "destination");
    const packages = (input.packages ?? []).map(validatePackage);
    const shipment = new Shipment(tenantId, {
      reference: input.reference?.trim() || documentReference("SHP"),
      orderRef: input.orderRef?.trim() || undefined,
      origin,
      destination,
      packages,
      status: "draft",
      progressRank: PROGRESS_RANK.draft!,
      requestedAccessorials: (input.accessorialCodes ?? []).map((c) => c.toUpperCase()),
      trackingEvents: [],
    });
    shipment.raise(
      envelope({
        eventType: LogisticsEvents.ShipmentCreated,
        aggregateType: "Shipment",
        aggregateId: shipment.id,
        tenantId,
        payload: {
          shipmentId: shipment.id,
          reference: shipment.props.reference,
          orderRef: shipment.props.orderRef,
          packageCount: packages.length,
          destinationCountry: destination.country,
        },
      }),
    );
    return shipment;
  }

  // -- accessors ------------------------------------------------------------

  get reference(): string {
    return this.props.reference;
  }

  get orderRef(): string | undefined {
    return this.props.orderRef;
  }

  get status(): ShipmentStatus {
    return this.props.status;
  }

  get origin(): Address {
    return this.props.origin;
  }

  get destination(): Address {
    return this.props.destination;
  }

  get packages(): readonly PackageLine[] {
    return this.props.packages;
  }

  get trackingNumber(): string | undefined {
    return this.props.trackingNumber;
  }

  get trackingEvents(): readonly TrackingEvent[] {
    return this.props.trackingEvents;
  }

  get carrierId(): Ulid | undefined {
    return this.props.carrierId;
  }

  get serviceLevelCode(): string | undefined {
    return this.props.serviceLevelCode;
  }

  get cost(): ShipmentCost | undefined {
    return this.props.cost;
  }

  get requestedAccessorials(): readonly string[] {
    return this.props.requestedAccessorials;
  }

  get podId(): Ulid | undefined {
    return this.props.podId;
  }

  isTerminal(): boolean {
    return this.props.status === "delivered" || this.props.status === "cancelled";
  }

  // -- package management (draft only) ---------------------------------------

  addPackage(input: PackageInput): PackageLine {
    this.assertStatus("add a package", ["draft"]);
    const line = validatePackage(input);
    this.props.packages.push(line);
    this.touch();
    return line;
  }

  removePackage(packageId: Ulid): void {
    this.assertStatus("remove a package", ["draft"]);
    const idx = this.props.packages.findIndex((p) => p.packageId === packageId);
    if (idx < 0) {
      throw new NotFoundError("Package", packageId);
    }
    this.props.packages.splice(idx, 1);
    this.touch();
  }

  // -- booking ----------------------------------------------------------------

  book(input: {
    carrierId: Ulid;
    carrierCode: string;
    serviceLevelCode: string;
    cost: ShipmentCost;
    trackingNumber?: string;
  }): void {
    this.assertStatus("book", ["draft"]);
    if (this.props.packages.length === 0) {
      throw new DomainError("Cannot book a shipment without packages", "VALIDATION");
    }
    this.props.carrierId = input.carrierId;
    this.props.carrierCode = input.carrierCode;
    this.props.serviceLevelCode = input.serviceLevelCode.toUpperCase();
    this.props.cost = input.cost;
    this.props.trackingNumber =
      input.trackingNumber?.trim() ||
      `${input.carrierCode}${Date.now().toString(36).toUpperCase()}${Math.random()
        .toString(36)
        .slice(2, 8)
        .toUpperCase()}`;
    this.props.status = "booked";
    this.props.progressRank = PROGRESS_RANK.booked!;
    this.raise(
      envelope<ShipmentBookedPayload>({
        eventType: LogisticsEvents.ShipmentBooked,
        aggregateType: "Shipment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          shipmentId: this.id,
          reference: this.props.reference,
          orderRef: this.props.orderRef,
          carrierId: input.carrierId,
          carrierCode: input.carrierCode,
          serviceLevelCode: this.props.serviceLevelCode,
          trackingNumber: this.props.trackingNumber,
          totalMinor: input.cost.totalMinor,
          currency: input.cost.currency,
        },
      }),
    );
  }

  // -- tracking ----------------------------------------------------------------

  /**
   * Records a carrier tracking event. Every event is appended to history;
   * the shipment status only ever advances (late scans never regress it).
   * An EX event flags the shipment as `exception` without losing progress:
   * the next forward scan clears it.
   */
  recordTrackingEvent(input: {
    code: TrackingCode;
    description?: string;
    location?: string;
    occurredAt?: string;
  }): TrackingEvent {
    if (!TRACKING_CODES.includes(input.code)) {
      throw new DomainError(
        `Unknown tracking code '${input.code}'; expected one of ${TRACKING_CODES.join(", ")}`,
        "VALIDATION",
      );
    }
    if (this.props.status === "draft") {
      throw new ConflictError("Cannot record tracking events before booking");
    }
    if (this.props.status === "cancelled") {
      throw new ConflictError("Cannot record tracking events on a cancelled shipment");
    }
    if (this.props.status === "delivered" && input.code !== "NT") {
      throw new ConflictError("Shipment already delivered; only NT notes are accepted");
    }

    const occurredAt = (
      input.occurredAt !== undefined
        ? assertIsoDateTime(input.occurredAt, "trackingEvent.occurredAt")
        : nowIso()
    ) as IsoDateTime;

    const event: TrackingEvent = {
      trackingEventId: newId("trk"),
      code: input.code,
      description: input.description?.trim() || CODE_DESCRIPTION[input.code],
      location: input.location?.trim() || undefined,
      occurredAt,
      recordedAt: nowIso(),
    };
    this.props.trackingEvents.push(event);

    const targetStatus = CODE_TO_STATUS[input.code];
    if (targetStatus === "exception") {
      this.props.status = "exception";
      this.raise(
        envelope({
          eventType: LogisticsEvents.ShipmentException,
          aggregateType: "Shipment",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            shipmentId: this.id,
            reference: this.props.reference,
            description: event.description,
            location: event.location,
            occurredAt: event.occurredAt,
          },
        }),
      );
    } else if (targetStatus !== undefined) {
      const targetRank = PROGRESS_RANK[targetStatus]!;
      if (targetRank > this.props.progressRank) {
        this.props.status = targetStatus;
        this.props.progressRank = targetRank;
      } else if (this.props.status === "exception") {
        // A repeat/late forward scan clears an exception back to the
        // furthest progress status already reached.
        this.props.status = this.statusForRank(this.props.progressRank);
      }
    }

    this.raise(
      envelope<ShipmentTrackingUpdatedPayload>({
        eventType: LogisticsEvents.ShipmentTrackingUpdated,
        aggregateType: "Shipment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          shipmentId: this.id,
          trackingNumber: this.props.trackingNumber,
          code: event.code,
          status: this.props.status,
          occurredAt: event.occurredAt,
          location: event.location,
        },
      }),
    );

    if (this.props.status === "delivered" && targetStatus === "delivered") {
      this.raise(
        envelope<ShipmentDeliveredPayload>({
          eventType: LogisticsEvents.ShipmentDelivered,
          aggregateType: "Shipment",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: {
            shipmentId: this.id,
            reference: this.props.reference,
            orderRef: this.props.orderRef,
            deliveredAt: event.occurredAt,
          },
        }),
      );
    }

    return event;
  }

  // -- proof of delivery ---------------------------------------------------------

  attachProofOfDelivery(podId: Ulid): void {
    if (this.props.status !== "delivered") {
      throw new ConflictError(
        `Proof of delivery can only be attached to a delivered shipment (status: ${this.props.status})`,
      );
    }
    if (this.props.podId !== undefined) {
      throw new ConflictError("Shipment already has a proof of delivery");
    }
    this.props.podId = podId;
    this.touch();
  }

  // -- cancellation -----------------------------------------------------------

  cancel(reason: string): void {
    this.assertStatus("cancel", ["draft", "booked"]);
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new DomainError("A cancellation reason is required", "VALIDATION");
    }
    this.props.status = "cancelled";
    this.props.cancelReason = reason.trim();
    this.raise(
      envelope({
        eventType: LogisticsEvents.ShipmentCancelled,
        aggregateType: "Shipment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { shipmentId: this.id, reference: this.props.reference, reason: this.props.cancelReason },
      }),
    );
  }

  // -- internals ---------------------------------------------------------------

  private statusForRank(rank: number): ShipmentStatus {
    const entry = Object.entries(PROGRESS_RANK).find(([, r]) => r === rank);
    return (entry?.[0] as ShipmentStatus) ?? "booked";
  }

  private assertStatus(action: string, allowed: ShipmentStatus[]): void {
    if (!allowed.includes(this.props.status)) {
      throw new ConflictError(
        `Cannot ${action} a shipment in status '${this.props.status}' (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

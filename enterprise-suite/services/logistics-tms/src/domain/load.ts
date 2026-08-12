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
import { LogisticsEvents, type LoadDispatchedPayload } from "./events.js";
import {
  assertIsoDateTime,
  documentReference,
  validateAddress,
  type Address,
} from "./values.js";

export type LoadStatus = "planned" | "dispatched" | "in_transit" | "completed" | "cancelled";
export type LoadMode = "ltl" | "ftl";
export type StopType = "pickup" | "delivery";

/** An ordered stop on the route. Sequences are unique and ascending. */
export interface LoadStop {
  readonly stopId: Ulid;
  readonly sequence: number;
  readonly type: StopType;
  readonly facilityName: string;
  readonly address: Address;
  readonly windowStart?: IsoDateTime;
  readonly windowEnd?: IsoDateTime;
  arrivedAt?: IsoDateTime;
  departedAt?: IsoDateTime;
}

/** A shipment routed on this load between two of its stops. */
export interface LoadAssignment {
  readonly shipmentId: Ulid;
  readonly pickupStopId: Ulid;
  readonly deliveryStopId: Ulid;
}

export interface LoadProps {
  reference: string;
  mode: LoadMode;
  status: LoadStatus;
  carrierId?: Ulid;
  driverName?: string;
  vehicleRef?: string;
  /** Planned route distance, when known (used for cost-per-km reporting). */
  plannedDistanceKm?: number;
  stops: LoadStop[];
  assignments: LoadAssignment[];
}

export interface AddStopInput {
  readonly sequence: number;
  readonly type: StopType;
  readonly facilityName: string;
  readonly address: Address;
  readonly windowStart?: string;
  readonly windowEnd?: string;
}

export class Load extends AggregateRoot<LoadProps> {
  private constructor(tenantId: TenantId, props: LoadProps) {
    super(tenantId, props);
  }

  static create(
    tenantId: TenantId,
    input: {
      reference?: string;
      mode: LoadMode;
      carrierId?: Ulid;
      driverName?: string;
      vehicleRef?: string;
      plannedDistanceKm?: number;
    },
  ): Load {
    if (input.mode !== "ltl" && input.mode !== "ftl") {
      throw new DomainError("load.mode must be ltl or ftl", "VALIDATION");
    }
    if (
      input.plannedDistanceKm !== undefined &&
      (typeof input.plannedDistanceKm !== "number" || input.plannedDistanceKm <= 0)
    ) {
      throw new DomainError("load.plannedDistanceKm must be positive", "VALIDATION");
    }
    const load = new Load(tenantId, {
      reference: input.reference?.trim() || documentReference("LOAD"),
      mode: input.mode,
      status: "planned",
      carrierId: input.carrierId,
      driverName: input.driverName?.trim() || undefined,
      vehicleRef: input.vehicleRef?.trim() || undefined,
      plannedDistanceKm: input.plannedDistanceKm,
      stops: [],
      assignments: [],
    });
    load.raise(
      envelope({
        eventType: LogisticsEvents.LoadCreated,
        aggregateType: "Load",
        aggregateId: load.id,
        tenantId,
        payload: { loadId: load.id, reference: load.props.reference, mode: input.mode },
      }),
    );
    return load;
  }

  // -- accessors --------------------------------------------------------------

  get reference(): string {
    return this.props.reference;
  }

  get mode(): LoadMode {
    return this.props.mode;
  }

  get status(): LoadStatus {
    return this.props.status;
  }

  get carrierId(): Ulid | undefined {
    return this.props.carrierId;
  }

  get stops(): readonly LoadStop[] {
    return this.props.stops;
  }

  get assignments(): readonly LoadAssignment[] {
    return this.props.assignments;
  }

  get shipmentIds(): readonly Ulid[] {
    return this.props.assignments.map((a) => a.shipmentId);
  }

  stop(stopId: Ulid): LoadStop {
    const stop = this.props.stops.find((s) => s.stopId === stopId);
    if (stop === undefined) {
      throw new NotFoundError("LoadStop", stopId);
    }
    return stop;
  }

  /** Shipments picked up at the given stop. */
  shipmentsPickedUpAt(stopId: Ulid): readonly Ulid[] {
    return this.props.assignments
      .filter((a) => a.pickupStopId === stopId)
      .map((a) => a.shipmentId);
  }

  /** Shipments delivered at the given stop. */
  shipmentsDeliveredAt(stopId: Ulid): readonly Ulid[] {
    return this.props.assignments
      .filter((a) => a.deliveryStopId === stopId)
      .map((a) => a.shipmentId);
  }

  // -- planning (only while planned) --------------------------------------------

  assignCarrier(carrierId: Ulid): void {
    this.assertStatus("assign a carrier to", ["planned"]);
    this.props.carrierId = carrierId;
    this.touch();
  }

  assignDriver(input: { driverName?: string; vehicleRef?: string }): void {
    this.assertStatus("assign a driver to", ["planned", "dispatched"]);
    if (input.driverName !== undefined) this.props.driverName = input.driverName.trim();
    if (input.vehicleRef !== undefined) this.props.vehicleRef = input.vehicleRef.trim();
    this.touch();
  }

  addStop(input: AddStopInput): LoadStop {
    this.assertStatus("add a stop to", ["planned"]);
    if (!Number.isInteger(input.sequence) || input.sequence < 1) {
      throw new DomainError("stop.sequence must be a positive integer", "VALIDATION");
    }
    if (input.type !== "pickup" && input.type !== "delivery") {
      throw new DomainError("stop.type must be pickup or delivery", "VALIDATION");
    }
    if (this.props.stops.some((s) => s.sequence === input.sequence)) {
      throw new ConflictError(`A stop with sequence ${input.sequence} already exists`);
    }
    if (typeof input.facilityName !== "string" || input.facilityName.trim().length === 0) {
      throw new DomainError("stop.facilityName is required", "VALIDATION");
    }
    const address = validateAddress(input.address, "stop.address");
    const windowStart =
      input.windowStart !== undefined
        ? (assertIsoDateTime(input.windowStart, "stop.windowStart") as IsoDateTime)
        : undefined;
    const windowEnd =
      input.windowEnd !== undefined
        ? (assertIsoDateTime(input.windowEnd, "stop.windowEnd") as IsoDateTime)
        : undefined;
    if (windowStart !== undefined && windowEnd !== undefined && windowEnd <= windowStart) {
      throw new DomainError("stop.windowEnd must be after windowStart", "VALIDATION");
    }
    const stop: LoadStop = {
      stopId: newId("stop"),
      sequence: input.sequence,
      type: input.type,
      facilityName: input.facilityName.trim(),
      address,
      windowStart,
      windowEnd,
    };
    this.props.stops.push(stop);
    this.props.stops.sort((a, b) => a.sequence - b.sequence);
    this.touch();
    return stop;
  }

  removeStop(stopId: Ulid): void {
    this.assertStatus("remove a stop from", ["planned"]);
    const stop = this.stop(stopId);
    const referenced = this.props.assignments.some(
      (a) => a.pickupStopId === stopId || a.deliveryStopId === stopId,
    );
    if (referenced) {
      throw new ConflictError(
        `Stop ${stop.sequence} is referenced by shipment assignments; unassign them first`,
      );
    }
    this.props.stops = this.props.stops.filter((s) => s.stopId !== stopId);
    this.touch();
  }

  /**
   * Routes a shipment on this load: it is picked up at one stop and
   * delivered at a later stop.
   */
  assignShipment(input: { shipmentId: Ulid; pickupStopId: Ulid; deliveryStopId: Ulid }): void {
    this.assertStatus("assign a shipment to", ["planned"]);
    if (this.props.assignments.some((a) => a.shipmentId === input.shipmentId)) {
      throw new ConflictError(`Shipment ${input.shipmentId} is already assigned to this load`);
    }
    const pickup = this.stop(input.pickupStopId);
    const delivery = this.stop(input.deliveryStopId);
    if (pickup.type !== "pickup") {
      throw new DomainError(`Stop ${pickup.sequence} is not a pickup stop`, "VALIDATION");
    }
    if (delivery.type !== "delivery") {
      throw new DomainError(`Stop ${delivery.sequence} is not a delivery stop`, "VALIDATION");
    }
    if (pickup.sequence >= delivery.sequence) {
      throw new DomainError(
        `Pickup (seq ${pickup.sequence}) must come before delivery (seq ${delivery.sequence})`,
        "VALIDATION",
      );
    }
    this.props.assignments.push({
      shipmentId: input.shipmentId,
      pickupStopId: input.pickupStopId,
      deliveryStopId: input.deliveryStopId,
    });
    this.touch();
  }

  unassignShipment(shipmentId: Ulid): void {
    this.assertStatus("unassign a shipment from", ["planned"]);
    const idx = this.props.assignments.findIndex((a) => a.shipmentId === shipmentId);
    if (idx < 0) {
      throw new NotFoundError("LoadAssignment", shipmentId);
    }
    this.props.assignments.splice(idx, 1);
    this.touch();
  }

  // -- execution -----------------------------------------------------------------

  dispatch(): void {
    this.assertStatus("dispatch", ["planned"]);
    if (this.props.carrierId === undefined) {
      throw new DomainError("Cannot dispatch a load without a carrier", "VALIDATION");
    }
    if (this.props.stops.length < 2) {
      throw new DomainError("Cannot dispatch a load with fewer than 2 stops", "VALIDATION");
    }
    if (this.props.assignments.length === 0) {
      throw new DomainError("Cannot dispatch a load with no shipments assigned", "VALIDATION");
    }
    this.props.status = "dispatched";
    this.raise(
      envelope<LoadDispatchedPayload>({
        eventType: LogisticsEvents.LoadDispatched,
        aggregateType: "Load",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          loadId: this.id,
          reference: this.props.reference,
          carrierId: this.props.carrierId,
          shipmentIds: this.shipmentIds,
          stopCount: this.props.stops.length,
        },
      }),
    );
  }

  recordStopArrival(stopId: Ulid, at?: string): LoadStop {
    this.assertStatus("record an arrival on", ["dispatched", "in_transit"]);
    const stop = this.stop(stopId);
    if (stop.arrivedAt !== undefined) {
      throw new ConflictError(`Arrival already recorded for stop ${stop.sequence}`);
    }
    const priorUnvisited = this.props.stops.filter(
      (s) => s.sequence < stop.sequence && s.arrivedAt === undefined,
    );
    if (priorUnvisited.length > 0) {
      throw new ConflictError(
        `Cannot arrive at stop ${stop.sequence}: earlier stop(s) ${priorUnvisited
          .map((s) => s.sequence)
          .join(", ")} not yet visited`,
      );
    }
    stop.arrivedAt = (at !== undefined
      ? assertIsoDateTime(at, "arrivedAt")
      : nowIso()) as IsoDateTime;
    this.props.status = "in_transit";
    this.raise(
      envelope({
        eventType: LogisticsEvents.LoadStopArrived,
        aggregateType: "Load",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          loadId: this.id,
          stopId,
          sequence: stop.sequence,
          stopType: stop.type,
          arrivedAt: stop.arrivedAt,
        },
      }),
    );
    return stop;
  }

  recordStopDeparture(stopId: Ulid, at?: string): LoadStop {
    this.assertStatus("record a departure on", ["in_transit"]);
    const stop = this.stop(stopId);
    if (stop.arrivedAt === undefined) {
      throw new ConflictError(`Cannot depart stop ${stop.sequence} before arriving`);
    }
    if (stop.departedAt !== undefined) {
      throw new ConflictError(`Departure already recorded for stop ${stop.sequence}`);
    }
    const departedAt = (at !== undefined
      ? assertIsoDateTime(at, "departedAt")
      : nowIso()) as IsoDateTime;
    if (departedAt < stop.arrivedAt) {
      throw new DomainError("departedAt cannot be before arrivedAt", "VALIDATION");
    }
    stop.departedAt = departedAt;
    this.raise(
      envelope({
        eventType: LogisticsEvents.LoadStopDeparted,
        aggregateType: "Load",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          loadId: this.id,
          stopId,
          sequence: stop.sequence,
          stopType: stop.type,
          departedAt,
        },
      }),
    );
    return stop;
  }

  complete(): void {
    this.assertStatus("complete", ["in_transit"]);
    const unvisited = this.props.stops.filter((s) => s.arrivedAt === undefined);
    if (unvisited.length > 0) {
      throw new ConflictError(
        `Cannot complete load: stop(s) ${unvisited.map((s) => s.sequence).join(", ")} not visited`,
      );
    }
    this.props.status = "completed";
    this.raise(
      envelope({
        eventType: LogisticsEvents.LoadCompleted,
        aggregateType: "Load",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          loadId: this.id,
          reference: this.props.reference,
          shipmentIds: this.shipmentIds,
        },
      }),
    );
  }

  cancel(reason: string): void {
    this.assertStatus("cancel", ["planned", "dispatched"]);
    if (typeof reason !== "string" || reason.trim().length === 0) {
      throw new DomainError("A cancellation reason is required", "VALIDATION");
    }
    this.props.status = "cancelled";
    this.raise(
      envelope({
        eventType: LogisticsEvents.LoadCancelled,
        aggregateType: "Load",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { loadId: this.id, reference: this.props.reference, reason: reason.trim() },
      }),
    );
  }

  // -- internals -------------------------------------------------------------------

  private assertStatus(action: string, allowed: LoadStatus[]): void {
    if (!allowed.includes(this.props.status)) {
      throw new ConflictError(
        `Cannot ${action} a load in status '${this.props.status}' (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

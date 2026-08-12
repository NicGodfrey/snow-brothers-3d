import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  nowIso,
  type IsoDateTime,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { LogisticsEvents, type DockAppointmentConfirmedPayload } from "./events.js";
import { assertIsoDateTime, documentReference } from "./values.js";

export type DockAppointmentStatus =
  | "requested"
  | "confirmed"
  | "checked_in"
  | "completed"
  | "cancelled"
  | "no_show";

export type DockDirection = "inbound" | "outbound";

/** Statuses that hold the dock door — used for overlap detection. */
const BLOCKING_STATUSES: readonly DockAppointmentStatus[] = [
  "requested",
  "confirmed",
  "checked_in",
];

/** Drivers may check in up to this many minutes before the window opens. */
export const CHECK_IN_GRACE_MINUTES = 30;

const MIN_WINDOW_MINUTES = 15;
const MAX_WINDOW_MINUTES = 8 * 60;

export interface DockAppointmentProps {
  referenceCode: string;
  facilityCode: string;
  dockDoor: string;
  direction: DockDirection;
  carrierId?: Ulid;
  loadId?: Ulid;
  windowStart: IsoDateTime;
  windowEnd: IsoDateTime;
  status: DockAppointmentStatus;
  checkedInAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  notes?: string;
}

export interface RequestDockAppointmentInput {
  readonly facilityCode: string;
  readonly dockDoor: string;
  readonly direction: DockDirection;
  readonly carrierId?: Ulid;
  readonly loadId?: Ulid;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly notes?: string;
}

function validateWindow(startRaw: string, endRaw: string): { start: IsoDateTime; end: IsoDateTime } {
  const start = assertIsoDateTime(startRaw, "windowStart") as IsoDateTime;
  const end = assertIsoDateTime(endRaw, "windowEnd") as IsoDateTime;
  const minutes = (Date.parse(end) - Date.parse(start)) / 60_000;
  if (minutes < MIN_WINDOW_MINUTES) {
    throw new DomainError(
      `Appointment window must be at least ${MIN_WINDOW_MINUTES} minutes`,
      "VALIDATION",
    );
  }
  if (minutes > MAX_WINDOW_MINUTES) {
    throw new DomainError(
      `Appointment window must be at most ${MAX_WINDOW_MINUTES / 60} hours`,
      "VALIDATION",
    );
  }
  return { start, end };
}

export class DockAppointment extends AggregateRoot<DockAppointmentProps> {
  private constructor(tenantId: TenantId, props: DockAppointmentProps) {
    super(tenantId, props);
  }

  static request(tenantId: TenantId, input: RequestDockAppointmentInput): DockAppointment {
    if (typeof input.facilityCode !== "string" || input.facilityCode.trim().length === 0) {
      throw new DomainError("facilityCode is required", "VALIDATION");
    }
    if (typeof input.dockDoor !== "string" || input.dockDoor.trim().length === 0) {
      throw new DomainError("dockDoor is required", "VALIDATION");
    }
    if (input.direction !== "inbound" && input.direction !== "outbound") {
      throw new DomainError("direction must be inbound or outbound", "VALIDATION");
    }
    const { start, end } = validateWindow(input.windowStart, input.windowEnd);
    const appointment = new DockAppointment(tenantId, {
      referenceCode: documentReference("DOCK"),
      facilityCode: input.facilityCode.trim().toUpperCase(),
      dockDoor: input.dockDoor.trim().toUpperCase(),
      direction: input.direction,
      carrierId: input.carrierId,
      loadId: input.loadId,
      windowStart: start,
      windowEnd: end,
      status: "requested",
      notes: input.notes?.trim() || undefined,
    });
    appointment.raise(
      envelope({
        eventType: LogisticsEvents.DockAppointmentRequested,
        aggregateType: "DockAppointment",
        aggregateId: appointment.id,
        tenantId,
        payload: {
          appointmentId: appointment.id,
          facilityCode: appointment.props.facilityCode,
          dockDoor: appointment.props.dockDoor,
          direction: input.direction,
          windowStart: start,
          windowEnd: end,
        },
      }),
    );
    return appointment;
  }

  // -- accessors ---------------------------------------------------------------

  get referenceCode(): string {
    return this.props.referenceCode;
  }

  get facilityCode(): string {
    return this.props.facilityCode;
  }

  get dockDoor(): string {
    return this.props.dockDoor;
  }

  get direction(): DockDirection {
    return this.props.direction;
  }

  get status(): DockAppointmentStatus {
    return this.props.status;
  }

  get windowStart(): IsoDateTime {
    return this.props.windowStart;
  }

  get windowEnd(): IsoDateTime {
    return this.props.windowEnd;
  }

  get loadId(): Ulid | undefined {
    return this.props.loadId;
  }

  /** Whether this appointment holds the door (for conflict detection). */
  isBlocking(): boolean {
    return BLOCKING_STATUSES.includes(this.props.status);
  }

  /** True when both appointments hold the same door with overlapping windows. */
  overlaps(other: DockAppointment): boolean {
    if (this.id === other.id) return false;
    if (this.props.facilityCode !== other.props.facilityCode) return false;
    if (this.props.dockDoor !== other.props.dockDoor) return false;
    if (!this.isBlocking() || !other.isBlocking()) return false;
    return (
      this.props.windowStart < other.props.windowEnd &&
      other.props.windowStart < this.props.windowEnd
    );
  }

  // -- lifecycle ----------------------------------------------------------------

  confirm(): void {
    this.assertStatus("confirm", ["requested"]);
    this.props.status = "confirmed";
    this.raise(
      envelope<DockAppointmentConfirmedPayload>({
        eventType: LogisticsEvents.DockAppointmentConfirmed,
        aggregateType: "DockAppointment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          appointmentId: this.id,
          facilityCode: this.props.facilityCode,
          dockDoor: this.props.dockDoor,
          windowStart: this.props.windowStart,
          windowEnd: this.props.windowEnd,
        },
      }),
    );
  }

  reschedule(windowStart: string, windowEnd: string): void {
    this.assertStatus("reschedule", ["requested", "confirmed"]);
    const { start, end } = validateWindow(windowStart, windowEnd);
    this.props.windowStart = start;
    this.props.windowEnd = end;
    // Rescheduling a confirmed appointment sends it back for re-confirmation.
    this.props.status = "requested";
    this.raise(
      envelope({
        eventType: LogisticsEvents.DockAppointmentRescheduled,
        aggregateType: "DockAppointment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          appointmentId: this.id,
          facilityCode: this.props.facilityCode,
          dockDoor: this.props.dockDoor,
          windowStart: start,
          windowEnd: end,
        },
      }),
    );
  }

  checkIn(at?: string): void {
    this.assertStatus("check in", ["confirmed"]);
    const checkedInAt = (at !== undefined
      ? assertIsoDateTime(at, "checkedInAt")
      : nowIso()) as IsoDateTime;
    const earliest = new Date(
      Date.parse(this.props.windowStart) - CHECK_IN_GRACE_MINUTES * 60_000,
    ).toISOString();
    if (checkedInAt < earliest) {
      throw new ConflictError(
        `Too early to check in: window opens at ${this.props.windowStart} (grace ${CHECK_IN_GRACE_MINUTES}m)`,
      );
    }
    if (checkedInAt > this.props.windowEnd) {
      throw new ConflictError(
        `Window closed at ${this.props.windowEnd}; mark as no-show or reschedule`,
      );
    }
    this.props.status = "checked_in";
    this.props.checkedInAt = checkedInAt;
    this.raise(
      envelope({
        eventType: LogisticsEvents.DockAppointmentCheckedIn,
        aggregateType: "DockAppointment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { appointmentId: this.id, checkedInAt },
      }),
    );
  }

  complete(at?: string): void {
    this.assertStatus("complete", ["checked_in"]);
    const completedAt = (at !== undefined
      ? assertIsoDateTime(at, "completedAt")
      : nowIso()) as IsoDateTime;
    if (this.props.checkedInAt !== undefined && completedAt < this.props.checkedInAt) {
      throw new DomainError("completedAt cannot be before checkedInAt", "VALIDATION");
    }
    this.props.status = "completed";
    this.props.completedAt = completedAt;
    this.raise(
      envelope({
        eventType: LogisticsEvents.DockAppointmentCompleted,
        aggregateType: "DockAppointment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { appointmentId: this.id, completedAt },
      }),
    );
  }

  markNoShow(at?: string): void {
    this.assertStatus("mark no-show", ["confirmed"]);
    const observedAt = (at !== undefined
      ? assertIsoDateTime(at, "noShowAt")
      : nowIso()) as IsoDateTime;
    if (observedAt <= this.props.windowEnd) {
      throw new ConflictError(
        `Cannot mark no-show before the window closes at ${this.props.windowEnd}`,
      );
    }
    this.props.status = "no_show";
    this.raise(
      envelope({
        eventType: LogisticsEvents.DockAppointmentNoShow,
        aggregateType: "DockAppointment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { appointmentId: this.id, windowEnd: this.props.windowEnd },
      }),
    );
  }

  cancel(reason?: string): void {
    this.assertStatus("cancel", ["requested", "confirmed"]);
    this.props.status = "cancelled";
    this.raise(
      envelope({
        eventType: LogisticsEvents.DockAppointmentCancelled,
        aggregateType: "DockAppointment",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { appointmentId: this.id, reason: reason?.trim() || undefined },
      }),
    );
  }

  // -- internals ------------------------------------------------------------------

  private assertStatus(action: string, allowed: DockAppointmentStatus[]): void {
    if (!allowed.includes(this.props.status)) {
      throw new ConflictError(
        `Cannot ${action} an appointment in status '${this.props.status}' (allowed: ${allowed.join(", ")})`,
      );
    }
  }
}

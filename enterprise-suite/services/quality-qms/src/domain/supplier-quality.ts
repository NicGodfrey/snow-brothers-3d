/**
 * Supplier Quality Event aggregate.
 *
 * The QMS-side record of a quality incident attributed to a supplier.
 * These events are the integration surface towards SRM (srm-core
 * scorecards consume `quality.supplier-event.*` envelopes): each event
 * carries linkage fields back to the originating QMS document
 * (inspection lot, NCR, CAPA, audit) plus procurement references
 * (purchase order), and a demerit-point weight used for vendor rating.
 *
 * Optionally a SCAR (Supplier Corrective Action Request) is issued
 * against the event; the supplier's response is tracked with due dates
 * and acceptance.
 *
 * Workflow: open -> acknowledged -> in-remediation -> resolved
 *           open -> written-off (e.g. disputed and accepted as not
 *           supplier-caused; carries zero demerits thereafter)
 */
import {
  AggregateRoot,
  ConflictError,
  DomainError,
  envelope,
  nowIso,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { QualityEventTypes, type SupplierQualityEventRecordedPayload } from "./events.js";
import { StateMachine } from "./state-machine.js";

export type SupplierEventType =
  | "incoming-inspection-failure"
  | "ncr-issued"
  | "audit-finding"
  | "certification-lapse"
  | "delivery-quality"
  | "field-failure";

export type SupplierEventSeverity = "critical" | "major" | "minor";
export type SupplierEventStatus =
  | "open"
  | "acknowledged"
  | "in-remediation"
  | "resolved"
  | "written-off";

/** Demerit weights per severity; multiplied by the event-type factor. */
const SEVERITY_POINTS: Record<SupplierEventSeverity, number> = {
  critical: 20,
  major: 10,
  minor: 3,
};

/** Event types differ in how strongly they hit the supplier score. */
const TYPE_FACTOR: Record<SupplierEventType, number> = {
  "incoming-inspection-failure": 1.0,
  "ncr-issued": 1.2,
  "audit-finding": 1.0,
  "certification-lapse": 1.5,
  "delivery-quality": 0.8,
  "field-failure": 2.0,
};

export function defaultDemeritPoints(
  eventType: SupplierEventType,
  severity: SupplierEventSeverity,
): number {
  return Math.round(SEVERITY_POINTS[severity] * TYPE_FACTOR[eventType]);
}

export interface QmsLinkage {
  readonly inspectionLotId?: Ulid;
  readonly ncrId?: Ulid;
  readonly capaId?: Ulid;
  readonly auditId?: Ulid;
  readonly purchaseOrderRef?: string;
  readonly materialCode?: string;
}

export interface Scar {
  readonly scarNumber: string;
  readonly issuedAt: IsoDateTime;
  readonly issuedBy: UserId;
  readonly dueAt: IsoDateTime;
  readonly respondedAt?: IsoDateTime;
  readonly responseSummary?: string;
  readonly responseAccepted?: boolean;
  readonly reviewedBy?: UserId;
}

interface SupplierQualityEventProps {
  supplierId: string;
  supplierName?: string;
  eventType: SupplierEventType;
  severity: SupplierEventSeverity;
  description: string;
  status: SupplierEventStatus;
  demeritPoints: number;
  linkage: QmsLinkage;
  scar?: Scar;
  occurredAt: IsoDateTime;
  resolution?: { resolvedBy: UserId; resolvedAt: IsoDateTime; note?: string };
  writeOff?: { writtenOffBy: UserId; writtenOffAt: IsoDateTime; reason: string };
}

const supplierEventMachine = new StateMachine<SupplierEventStatus, SupplierQualityEvent>(
  "SupplierQualityEvent",
  [
    { from: "open", to: "acknowledged" },
    {
      from: ["open", "acknowledged"],
      to: "in-remediation",
      guard: (e) =>
        e.scar ? undefined : "a SCAR must be issued before moving to in-remediation",
    },
    {
      from: ["acknowledged", "in-remediation"],
      to: "resolved",
      guard: (e) => {
        if (!e.scar) return undefined; // no SCAR: direct resolution allowed
        if (!e.scar.respondedAt) return "SCAR response is outstanding";
        if (e.scar.responseAccepted !== true) return "SCAR response has not been accepted";
        return undefined;
      },
    },
    { from: ["open", "acknowledged"], to: "written-off" },
  ],
  ["resolved", "written-off"],
);

export class SupplierQualityEvent extends AggregateRoot<SupplierQualityEventProps> {
  private constructor(
    tenantId: TenantId,
    props: SupplierQualityEventProps,
    existing?: Partial<EntityProps>,
  ) {
    super(tenantId, props, existing);
  }

  static create(
    tenantId: TenantId,
    input: {
      supplierId: string;
      supplierName?: string;
      eventType: SupplierEventType;
      severity: SupplierEventSeverity;
      description: string;
      linkage?: QmsLinkage;
      demeritPointsOverride?: number;
      occurredAt?: IsoDateTime;
    },
  ): SupplierQualityEvent {
    if (!input.supplierId.trim()) throw new DomainError("supplierId is required", "VALIDATION");
    if (!input.description.trim()) throw new DomainError("description is required", "VALIDATION");
    if (input.demeritPointsOverride !== undefined && input.demeritPointsOverride < 0) {
      throw new DomainError("demeritPointsOverride must be >= 0", "VALIDATION");
    }
    const event = new SupplierQualityEvent(tenantId, {
      supplierId: input.supplierId.trim(),
      supplierName: input.supplierName,
      eventType: input.eventType,
      severity: input.severity,
      description: input.description.trim(),
      status: "open",
      demeritPoints:
        input.demeritPointsOverride ?? defaultDemeritPoints(input.eventType, input.severity),
      linkage: input.linkage ?? {},
      occurredAt: input.occurredAt ?? nowIso(),
    });
    const payload: SupplierQualityEventRecordedPayload = {
      supplierId: event.props.supplierId,
      eventType: input.eventType,
      severity: input.severity,
      demeritPoints: event.props.demeritPoints,
      ncrId: input.linkage?.ncrId,
      capaId: input.linkage?.capaId,
      inspectionLotId: input.linkage?.inspectionLotId,
      auditId: input.linkage?.auditId,
    };
    event.raise(
      envelope({
        eventType: QualityEventTypes.SupplierQualityEventRecorded,
        aggregateType: "SupplierQualityEvent",
        aggregateId: event.id,
        tenantId,
        payload,
      }),
    );
    return event;
  }

  static rehydrate(
    tenantId: TenantId,
    props: SupplierQualityEventProps,
    existing: Partial<EntityProps>,
  ): SupplierQualityEvent {
    return new SupplierQualityEvent(tenantId, props, existing);
  }

  get supplierId(): string { return this.props.supplierId; }
  get eventType(): SupplierEventType { return this.props.eventType; }
  get severity(): SupplierEventSeverity { return this.props.severity; }
  get status(): SupplierEventStatus { return this.props.status; }
  get demeritPoints(): number {
    return this.props.status === "written-off" ? 0 : this.props.demeritPoints;
  }
  get linkage(): QmsLinkage { return this.props.linkage; }
  get scar(): Scar | undefined { return this.props.scar; }
  get occurredAt(): IsoDateTime { return this.props.occurredAt; }

  acknowledge(): void {
    this.props.status = supplierEventMachine.assertTransition(this.props.status, "acknowledged", this);
  }

  issueScar(input: { scarNumber: string; issuedBy: UserId; dueAt: IsoDateTime }): Scar {
    if (this.props.scar) throw new ConflictError(`SCAR ${this.props.scar.scarNumber} already issued`);
    if (this.props.status === "resolved" || this.props.status === "written-off") {
      throw new ConflictError(`Cannot issue SCAR on a ${this.props.status} event`);
    }
    const scar: Scar = {
      scarNumber: input.scarNumber,
      issuedAt: nowIso(),
      issuedBy: input.issuedBy,
      dueAt: input.dueAt,
    };
    this.props.scar = scar;
    if (this.props.status === "open" || this.props.status === "acknowledged") {
      this.props.status = supplierEventMachine.assertTransition(this.props.status, "in-remediation", this);
    }
    this.raise(
      envelope({
        eventType: QualityEventTypes.ScarIssued,
        aggregateType: "SupplierQualityEvent",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          supplierId: this.props.supplierId,
          scarNumber: input.scarNumber,
          dueAt: input.dueAt,
        },
      }),
    );
    return scar;
  }

  recordScarResponse(input: { responseSummary: string; accepted: boolean; reviewedBy: UserId }): Scar {
    const scar = this.props.scar;
    if (!scar) throw new ConflictError("No SCAR issued for this event");
    if (scar.respondedAt && scar.responseAccepted === true) {
      throw new ConflictError("SCAR response already accepted");
    }
    if (!input.responseSummary.trim()) {
      throw new DomainError("responseSummary is required", "VALIDATION");
    }
    const updated: Scar = {
      ...scar,
      respondedAt: nowIso(),
      responseSummary: input.responseSummary.trim(),
      responseAccepted: input.accepted,
      reviewedBy: input.reviewedBy,
    };
    this.props.scar = updated;
    this.raise(
      envelope({
        eventType: QualityEventTypes.ScarResponseRecorded,
        aggregateType: "SupplierQualityEvent",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          supplierId: this.props.supplierId,
          scarNumber: scar.scarNumber,
          accepted: input.accepted,
        },
      }),
    );
    this.touch();
    return updated;
  }

  resolve(resolvedBy: UserId, note?: string): void {
    this.props.status = supplierEventMachine.assertTransition(this.props.status, "resolved", this);
    this.props.resolution = { resolvedBy, resolvedAt: nowIso(), note };
    this.raise(
      envelope({
        eventType: QualityEventTypes.SupplierQualityEventResolved,
        aggregateType: "SupplierQualityEvent",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { supplierId: this.props.supplierId, eventType: this.props.eventType },
      }),
    );
  }

  writeOff(writtenOffBy: UserId, reason: string): void {
    if (!reason.trim()) throw new DomainError("write-off reason is required", "VALIDATION");
    this.props.status = supplierEventMachine.assertTransition(this.props.status, "written-off", this);
    this.props.writeOff = { writtenOffBy, writtenOffAt: nowIso(), reason: reason.trim() };
    this.touch();
  }

  isScarOverdue(now: IsoDateTime): boolean {
    return !!this.props.scar && !this.props.scar.respondedAt && this.props.scar.dueAt < now;
  }
}

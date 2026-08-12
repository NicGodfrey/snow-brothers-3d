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
import { AggregateRoot, ConflictError, DomainError, envelope, nowIso, } from "@enterprise-suite/shared-kernel";
import { QualityEventTypes } from "./events.js";
import { StateMachine } from "./state-machine.js";
/** Demerit weights per severity; multiplied by the event-type factor. */
const SEVERITY_POINTS = {
    critical: 20,
    major: 10,
    minor: 3,
};
/** Event types differ in how strongly they hit the supplier score. */
const TYPE_FACTOR = {
    "incoming-inspection-failure": 1.0,
    "ncr-issued": 1.2,
    "audit-finding": 1.0,
    "certification-lapse": 1.5,
    "delivery-quality": 0.8,
    "field-failure": 2.0,
};
export function defaultDemeritPoints(eventType, severity) {
    return Math.round(SEVERITY_POINTS[severity] * TYPE_FACTOR[eventType]);
}
const supplierEventMachine = new StateMachine("SupplierQualityEvent", [
    { from: "open", to: "acknowledged" },
    {
        from: ["open", "acknowledged"],
        to: "in-remediation",
        guard: (e) => e.scar ? undefined : "a SCAR must be issued before moving to in-remediation",
    },
    {
        from: ["acknowledged", "in-remediation"],
        to: "resolved",
        guard: (e) => {
            if (!e.scar)
                return undefined; // no SCAR: direct resolution allowed
            if (!e.scar.respondedAt)
                return "SCAR response is outstanding";
            if (e.scar.responseAccepted !== true)
                return "SCAR response has not been accepted";
            return undefined;
        },
    },
    { from: ["open", "acknowledged"], to: "written-off" },
], ["resolved", "written-off"]);
export class SupplierQualityEvent extends AggregateRoot {
    constructor(tenantId, props, existing) {
        super(tenantId, props, existing);
    }
    static create(tenantId, input) {
        if (!input.supplierId.trim())
            throw new DomainError("supplierId is required", "VALIDATION");
        if (!input.description.trim())
            throw new DomainError("description is required", "VALIDATION");
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
            demeritPoints: input.demeritPointsOverride ?? defaultDemeritPoints(input.eventType, input.severity),
            linkage: input.linkage ?? {},
            occurredAt: input.occurredAt ?? nowIso(),
        });
        const payload = {
            supplierId: event.props.supplierId,
            eventType: input.eventType,
            severity: input.severity,
            demeritPoints: event.props.demeritPoints,
            ncrId: input.linkage?.ncrId,
            capaId: input.linkage?.capaId,
            inspectionLotId: input.linkage?.inspectionLotId,
            auditId: input.linkage?.auditId,
        };
        event.raise(envelope({
            eventType: QualityEventTypes.SupplierQualityEventRecorded,
            aggregateType: "SupplierQualityEvent",
            aggregateId: event.id,
            tenantId,
            payload,
        }));
        return event;
    }
    static rehydrate(tenantId, props, existing) {
        return new SupplierQualityEvent(tenantId, props, existing);
    }
    get supplierId() { return this.props.supplierId; }
    get eventType() { return this.props.eventType; }
    get severity() { return this.props.severity; }
    get status() { return this.props.status; }
    get demeritPoints() {
        return this.props.status === "written-off" ? 0 : this.props.demeritPoints;
    }
    get linkage() { return this.props.linkage; }
    get scar() { return this.props.scar; }
    get occurredAt() { return this.props.occurredAt; }
    acknowledge() {
        this.props.status = supplierEventMachine.assertTransition(this.props.status, "acknowledged", this);
    }
    issueScar(input) {
        if (this.props.scar)
            throw new ConflictError(`SCAR ${this.props.scar.scarNumber} already issued`);
        if (this.props.status === "resolved" || this.props.status === "written-off") {
            throw new ConflictError(`Cannot issue SCAR on a ${this.props.status} event`);
        }
        const scar = {
            scarNumber: input.scarNumber,
            issuedAt: nowIso(),
            issuedBy: input.issuedBy,
            dueAt: input.dueAt,
        };
        this.props.scar = scar;
        if (this.props.status === "open" || this.props.status === "acknowledged") {
            this.props.status = supplierEventMachine.assertTransition(this.props.status, "in-remediation", this);
        }
        this.raise(envelope({
            eventType: QualityEventTypes.ScarIssued,
            aggregateType: "SupplierQualityEvent",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                supplierId: this.props.supplierId,
                scarNumber: input.scarNumber,
                dueAt: input.dueAt,
            },
        }));
        return scar;
    }
    recordScarResponse(input) {
        const scar = this.props.scar;
        if (!scar)
            throw new ConflictError("No SCAR issued for this event");
        if (scar.respondedAt && scar.responseAccepted === true) {
            throw new ConflictError("SCAR response already accepted");
        }
        if (!input.responseSummary.trim()) {
            throw new DomainError("responseSummary is required", "VALIDATION");
        }
        const updated = {
            ...scar,
            respondedAt: nowIso(),
            responseSummary: input.responseSummary.trim(),
            responseAccepted: input.accepted,
            reviewedBy: input.reviewedBy,
        };
        this.props.scar = updated;
        this.raise(envelope({
            eventType: QualityEventTypes.ScarResponseRecorded,
            aggregateType: "SupplierQualityEvent",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                supplierId: this.props.supplierId,
                scarNumber: scar.scarNumber,
                accepted: input.accepted,
            },
        }));
        this.touch();
        return updated;
    }
    resolve(resolvedBy, note) {
        this.props.status = supplierEventMachine.assertTransition(this.props.status, "resolved", this);
        this.props.resolution = { resolvedBy, resolvedAt: nowIso(), note };
        this.raise(envelope({
            eventType: QualityEventTypes.SupplierQualityEventResolved,
            aggregateType: "SupplierQualityEvent",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { supplierId: this.props.supplierId, eventType: this.props.eventType },
        }));
    }
    writeOff(writtenOffBy, reason) {
        if (!reason.trim())
            throw new DomainError("write-off reason is required", "VALIDATION");
        this.props.status = supplierEventMachine.assertTransition(this.props.status, "written-off", this);
        this.props.writeOff = { writtenOffBy, writtenOffAt: nowIso(), reason: reason.trim() };
        this.touch();
    }
    isScarOverdue(now) {
        return !!this.props.scar && !this.props.scar.respondedAt && this.props.scar.dueAt < now;
    }
}
//# sourceMappingURL=supplier-quality.js.map
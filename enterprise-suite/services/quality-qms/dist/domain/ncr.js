/**
 * Non-Conformance Report (NCR) aggregate.
 *
 * An NCR documents a deviation: what is wrong, how much material is
 * affected, where it came from (inspection lot, production, supplier,
 * customer complaint, audit) and how the material is dispositioned.
 *
 * Workflow:
 *   draft -> open -> containment -> disposition -> closed
 *                 \______________/^
 *   (minor NCRs may skip containment: open -> disposition)
 *   any non-terminal state -> cancelled
 *
 * Rules encoded here:
 *  - containment can only finish when all containment actions are done
 *  - "use-as-is" and "regrade" dispositions always require approval;
 *    any disposition on a critical NCR requires approval
 *  - closing requires an approved disposition (when approval is required)
 *  - escalation to CAPA links the NCR and is recorded as an event
 */
import { AggregateRoot, ConflictError, DomainError, envelope, newId, nowIso, } from "@enterprise-suite/shared-kernel";
import { QualityEventTypes } from "./events.js";
import { StateMachine } from "./state-machine.js";
function dispositionNeedsApproval(type, severity) {
    if (type === "use-as-is" || type === "regrade")
        return true;
    return severity === "critical";
}
const ncrMachine = new StateMachine("NCR", [
    { from: "draft", to: "open" },
    { from: "open", to: "containment" },
    {
        from: "containment",
        to: "disposition",
        guard: (ncr) => {
            const open = ncr.containmentActions.filter((a) => a.status === "open");
            return open.length > 0
                ? `${open.length} containment action(s) still open`
                : ncr.containmentActions.length === 0
                    ? "at least one containment action must be recorded before moving to disposition"
                    : undefined;
        },
    },
    {
        from: "open",
        to: "disposition",
        guard: (ncr) => ncr.severity === "minor"
            ? undefined
            : "only minor NCRs may skip containment",
    },
    {
        from: "disposition",
        to: "closed",
        guard: (ncr) => {
            if (!ncr.disposition)
                return "a disposition must be recorded before closing";
            if (ncr.disposition.requiresApproval && !ncr.disposition.approvedBy) {
                return `disposition '${ncr.disposition.type}' requires approval before closing`;
            }
            return undefined;
        },
    },
    { from: ["draft", "open", "containment", "disposition"], to: "cancelled" },
], ["closed", "cancelled"]);
export class NonConformanceReport extends AggregateRoot {
    constructor(tenantId, props, existing) {
        super(tenantId, props, existing);
    }
    static create(tenantId, input) {
        if (!input.title.trim())
            throw new DomainError("title is required", "VALIDATION");
        if (!input.description.trim())
            throw new DomainError("description is required", "VALIDATION");
        if (input.quantityAffected !== undefined && input.quantityAffected <= 0) {
            throw new DomainError("quantityAffected must be positive", "VALIDATION");
        }
        if (input.source === "supplier" && !input.linkage?.supplierId) {
            throw new DomainError("supplier-sourced NCRs require linkage.supplierId", "VALIDATION");
        }
        const ncr = new NonConformanceReport(tenantId, {
            ncrNumber: input.ncrNumber,
            title: input.title.trim(),
            description: input.description.trim(),
            source: input.source,
            severity: input.severity,
            status: "draft",
            defectCode: input.defectCode,
            quantityAffected: input.quantityAffected,
            uom: input.uom,
            materialCode: input.materialCode,
            linkage: input.linkage ?? {},
            containmentActions: [],
        });
        ncr.raise(envelope({
            eventType: QualityEventTypes.NcrCreated,
            aggregateType: "NonConformanceReport",
            aggregateId: ncr.id,
            tenantId,
            payload: { ncrNumber: input.ncrNumber, source: input.source, severity: input.severity },
        }));
        return ncr;
    }
    static rehydrate(tenantId, props, existing) {
        return new NonConformanceReport(tenantId, props, existing);
    }
    get ncrNumber() { return this.props.ncrNumber; }
    get status() { return this.props.status; }
    get severity() { return this.props.severity; }
    get source() { return this.props.source; }
    get linkage() { return this.props.linkage; }
    get containmentActions() { return this.props.containmentActions; }
    get disposition() { return this.props.disposition; }
    get capaId() { return this.props.capaId; }
    get quantityAffected() { return this.props.quantityAffected; }
    get materialCode() { return this.props.materialCode; }
    get title() { return this.props.title; }
    get description() { return this.props.description; }
    submit() {
        this.props.status = ncrMachine.assertTransition(this.props.status, "open", this);
        const payload = {
            ncrNumber: this.props.ncrNumber,
            source: this.props.source,
            severity: this.props.severity,
            inspectionLotId: this.props.linkage.inspectionLotId,
            supplierId: this.props.linkage.supplierId,
            workOrderRef: this.props.linkage.workOrderRef,
            quantityAffected: this.props.quantityAffected,
        };
        this.raise(envelope({
            eventType: QualityEventTypes.NcrOpened,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload,
        }));
    }
    startContainment() {
        this.props.status = ncrMachine.assertTransition(this.props.status, "containment", this);
        this.raise(envelope({
            eventType: QualityEventTypes.NcrContainmentStarted,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { ncrNumber: this.props.ncrNumber },
        }));
    }
    addContainmentAction(input) {
        if (this.props.status !== "containment") {
            throw new ConflictError(`Containment actions can only be added in 'containment' status (current: ${this.props.status})`);
        }
        if (!input.description.trim())
            throw new DomainError("description is required", "VALIDATION");
        const action = {
            id: newId("cact"),
            description: input.description.trim(),
            owner: input.owner,
            dueAt: input.dueAt,
            status: "open",
        };
        this.props.containmentActions.push(action);
        this.touch();
        return action;
    }
    completeContainmentAction(actionId, note) {
        const idx = this.props.containmentActions.findIndex((a) => a.id === actionId);
        if (idx === -1)
            throw new DomainError(`Containment action ${actionId} not found`, "NOT_FOUND", 404);
        const action = this.props.containmentActions[idx];
        if (action.status === "done")
            throw new ConflictError("Containment action already completed");
        const updated = {
            ...action,
            status: "done",
            completedAt: nowIso(),
            completionNote: note,
        };
        this.props.containmentActions[idx] = updated;
        this.touch();
        return updated;
    }
    moveToDisposition() {
        this.props.status = ncrMachine.assertTransition(this.props.status, "disposition", this);
    }
    recordDisposition(input) {
        if (this.props.status !== "disposition") {
            throw new ConflictError(`Disposition can only be recorded in 'disposition' status (current: ${this.props.status})`);
        }
        if (!input.justification.trim()) {
            throw new DomainError("Disposition justification is required", "VALIDATION");
        }
        if (input.type === "return-to-supplier" && !this.props.linkage.supplierId) {
            throw new ConflictError("return-to-supplier disposition requires a linked supplierId");
        }
        const disposition = {
            type: input.type,
            justification: input.justification.trim(),
            requiresApproval: dispositionNeedsApproval(input.type, this.props.severity),
            decidedBy: input.decidedBy,
            decidedAt: nowIso(),
        };
        this.props.disposition = disposition;
        const payload = {
            ncrNumber: this.props.ncrNumber,
            dispositionType: input.type,
            requiresApproval: disposition.requiresApproval,
            quantityAffected: this.props.quantityAffected,
        };
        this.raise(envelope({
            eventType: QualityEventTypes.NcrDispositioned,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload,
        }));
        return disposition;
    }
    approveDisposition(approvedBy) {
        const disposition = this.props.disposition;
        if (!disposition)
            throw new ConflictError("No disposition recorded yet");
        if (!disposition.requiresApproval) {
            throw new ConflictError(`Disposition '${disposition.type}' does not require approval`);
        }
        if (disposition.approvedBy)
            throw new ConflictError("Disposition already approved");
        if (disposition.decidedBy === approvedBy) {
            throw new ConflictError("Disposition approver must differ from the decider (four-eyes rule)");
        }
        this.props.disposition = { ...disposition, approvedBy, approvedAt: nowIso() };
        this.raise(envelope({
            eventType: QualityEventTypes.NcrDispositionApproved,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { ncrNumber: this.props.ncrNumber, dispositionType: disposition.type },
        }));
    }
    linkCapa(capaId) {
        if (this.props.status === "closed" || this.props.status === "cancelled") {
            throw new ConflictError(`Cannot escalate a ${this.props.status} NCR to CAPA`);
        }
        if (this.props.capaId)
            throw new ConflictError(`NCR already escalated to CAPA ${this.props.capaId}`);
        this.props.capaId = capaId;
        this.raise(envelope({
            eventType: QualityEventTypes.NcrEscalatedToCapa,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { ncrNumber: this.props.ncrNumber, capaId },
        }));
    }
    close(closedBy, note) {
        this.props.status = ncrMachine.assertTransition(this.props.status, "closed", this);
        this.props.closure = { closedBy, closedAt: nowIso(), note };
        this.raise(envelope({
            eventType: QualityEventTypes.NcrClosed,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {
                ncrNumber: this.props.ncrNumber,
                dispositionType: this.props.disposition?.type,
                capaId: this.props.capaId,
            },
        }));
    }
    cancel(cancelledBy, reason) {
        if (!reason.trim())
            throw new DomainError("Cancellation reason is required", "VALIDATION");
        this.props.status = ncrMachine.assertTransition(this.props.status, "cancelled", this);
        this.props.cancellation = { cancelledBy, cancelledAt: nowIso(), reason: reason.trim() };
        this.raise(envelope({
            eventType: QualityEventTypes.NcrCancelled,
            aggregateType: "NonConformanceReport",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { ncrNumber: this.props.ncrNumber, reason: reason.trim() },
        }));
    }
}
//# sourceMappingURL=ncr.js.map
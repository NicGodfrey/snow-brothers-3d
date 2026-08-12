import { AggregateRoot, DomainError, envelope, nowIso, } from "@enterprise-suite/shared-kernel";
import { HcmEvents } from "./events.js";
/**
 * Requisition lifecycle:
 *   draft → pending_approval → open ⇄ on_hold → filled
 * with cancellation possible from every non-terminal state.
 */
export class HiringRequisition extends AggregateRoot {
    constructor(tenantId, props) {
        super(tenantId, props);
    }
    static createDraft(tenantId, input) {
        const headcount = input.headcount ?? 1;
        if (!Number.isInteger(headcount) || headcount < 1 || headcount > 100) {
            throw new DomainError(`Headcount must be an integer in [1, 100], got ${headcount}`, "INVALID_HEADCOUNT");
        }
        if (!input.title.trim())
            throw new DomainError("Requisition title is required", "INVALID_REQUISITION");
        if (input.justification.trim().length < 10) {
            throw new DomainError("A hiring justification of at least 10 characters is required", "JUSTIFICATION_REQUIRED");
        }
        if (input.salaryBand) {
            const { min, max } = input.salaryBand;
            if (min.currency !== max.currency) {
                throw new DomainError("Salary band min and max must share a currency", "CURRENCY_MISMATCH");
            }
            if (min.amountMinor <= 0 || max.amountMinor < min.amountMinor) {
                throw new DomainError("Salary band must satisfy 0 < min <= max", "INVALID_SALARY_BAND");
            }
        }
        return new HiringRequisition(tenantId, {
            positionId: input.positionId,
            orgUnitId: input.orgUnitId,
            title: input.title.trim(),
            headcount,
            hiringManagerId: input.hiringManagerId,
            recruiterId: input.recruiterId,
            justification: input.justification.trim(),
            salaryBand: input.salaryBand,
            targetStartDate: input.targetStartDate,
            status: "draft",
            approvals: [],
            hiredEmployeeIds: [],
        });
    }
    get positionId() {
        return this.props.positionId;
    }
    get orgUnitId() {
        return this.props.orgUnitId;
    }
    get title() {
        return this.props.title;
    }
    get status() {
        return this.props.status;
    }
    get headcount() {
        return this.props.headcount;
    }
    get hiringManagerId() {
        return this.props.hiringManagerId;
    }
    get approvals() {
        return this.props.approvals;
    }
    get hiredEmployeeIds() {
        return this.props.hiredEmployeeIds;
    }
    get salaryBand() {
        return this.props.salaryBand;
    }
    get remainingHeadcount() {
        return this.props.headcount - this.props.hiredEmployeeIds.length;
    }
    submitForApproval() {
        this.assertStatus("draft", "submit");
        this.props.status = "pending_approval";
        this.raise(envelope({
            eventType: HcmEvents.RequisitionSubmitted,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { positionId: this.props.positionId, title: this.props.title, headcount: this.props.headcount },
        }));
    }
    approve(approverId, comment) {
        this.assertStatus("pending_approval", "approve");
        if (approverId === this.props.hiringManagerId) {
            throw new DomainError("The hiring manager cannot approve their own requisition", "SELF_APPROVAL", 403);
        }
        this.props.approvals.push({ approverId, decision: "approved", decidedAt: nowIso(), comment });
        this.props.status = "open";
        this.props.openedAt = nowIso();
        this.raise(envelope({
            eventType: HcmEvents.RequisitionApproved,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { approverId, positionId: this.props.positionId },
        }));
        this.raise(envelope({
            eventType: HcmEvents.RequisitionOpened,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { positionId: this.props.positionId, title: this.props.title, headcount: this.props.headcount },
        }));
    }
    reject(approverId, comment) {
        this.assertStatus("pending_approval", "reject");
        if (!comment.trim()) {
            throw new DomainError("A rejection must include a comment", "REJECTION_NOTE_REQUIRED");
        }
        this.props.approvals.push({ approverId, decision: "rejected", decidedAt: nowIso(), comment });
        this.props.status = "draft";
        this.raise(envelope({
            eventType: HcmEvents.RequisitionRejected,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { approverId, comment },
        }));
    }
    hold(note) {
        this.assertStatus("open", "hold");
        this.props.status = "on_hold";
        this.props.holdNote = note;
        this.raise(envelope({
            eventType: HcmEvents.RequisitionHeld,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { note },
        }));
    }
    resume() {
        this.assertStatus("on_hold", "resume");
        this.props.status = "open";
        this.props.holdNote = undefined;
        this.raise(envelope({
            eventType: HcmEvents.RequisitionResumed,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: {},
        }));
    }
    /** Records a completed hire; transitions to filled once headcount is reached. */
    recordHire(employeeId) {
        this.assertStatus("open", "record a hire against");
        if (this.props.hiredEmployeeIds.includes(employeeId)) {
            throw new DomainError("This employee is already recorded on the requisition", "DUPLICATE_HIRE", 409);
        }
        this.props.hiredEmployeeIds.push(employeeId);
        this.raise(envelope({
            eventType: HcmEvents.RequisitionHireRecorded,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { employeeId, remainingHeadcount: this.remainingHeadcount },
        }));
        if (this.remainingHeadcount === 0) {
            this.props.status = "filled";
            this.props.filledAt = nowIso();
            this.raise(envelope({
                eventType: HcmEvents.RequisitionFilled,
                aggregateType: "HiringRequisition",
                aggregateId: this.id,
                tenantId: this.tenantId,
                payload: {
                    requisitionId: this.id,
                    positionId: this.props.positionId,
                    hiredEmployeeIds: [...this.props.hiredEmployeeIds],
                },
            }));
        }
    }
    cancel(note) {
        if (this.props.status === "filled" || this.props.status === "cancelled") {
            throw new DomainError(`Cannot cancel a ${this.props.status} requisition`, "INVALID_STATUS_TRANSITION", 409);
        }
        if (!note.trim()) {
            throw new DomainError("A cancellation must include a note", "CANCELLATION_NOTE_REQUIRED");
        }
        this.props.status = "cancelled";
        this.props.cancellationNote = note.trim();
        this.raise(envelope({
            eventType: HcmEvents.RequisitionCancelled,
            aggregateType: "HiringRequisition",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { note: this.props.cancellationNote },
        }));
    }
    assertStatus(expected, action) {
        if (this.props.status !== expected) {
            throw new DomainError(`Cannot ${action} a requisition in status ${this.props.status} (expected ${expected})`, "INVALID_STATUS_TRANSITION", 409);
        }
    }
}
//# sourceMappingURL=requisition.js.map
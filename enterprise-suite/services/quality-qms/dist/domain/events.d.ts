/**
 * Domain event catalog for the Quality QMS bounded context.
 *
 * Every event is published through the transactional outbox as a
 * shared-kernel `EventEnvelope`. Payloads are intentionally flat and
 * serialization-friendly so downstream consumers (reporting-bi,
 * srm-core, integration-hub) can project them without importing our
 * domain classes.
 */
import type { Ulid } from "@enterprise-suite/shared-kernel";
export declare const QualityEventTypes: {
    readonly InspectionPlanCreated: "quality.inspection-plan.created";
    readonly InspectionPlanActivated: "quality.inspection-plan.activated";
    readonly InspectionPlanRetired: "quality.inspection-plan.retired";
    readonly InspectionPlanRevised: "quality.inspection-plan.revised";
    readonly InspectionLotCreated: "quality.inspection-lot.created";
    readonly InspectionLotStarted: "quality.inspection-lot.started";
    readonly InspectionResultRecorded: "quality.inspection-lot.result-recorded";
    readonly InspectionLotCompleted: "quality.inspection-lot.completed";
    readonly InspectionLotDecided: "quality.inspection-lot.usage-decided";
    readonly InspectionLotCancelled: "quality.inspection-lot.cancelled";
    readonly NcrCreated: "quality.ncr.created";
    readonly NcrOpened: "quality.ncr.opened";
    readonly NcrContainmentStarted: "quality.ncr.containment-started";
    readonly NcrDispositioned: "quality.ncr.dispositioned";
    readonly NcrDispositionApproved: "quality.ncr.disposition-approved";
    readonly NcrClosed: "quality.ncr.closed";
    readonly NcrCancelled: "quality.ncr.cancelled";
    readonly NcrEscalatedToCapa: "quality.ncr.escalated-to-capa";
    readonly CapaCreated: "quality.capa.created";
    readonly CapaStateChanged: "quality.capa.state-changed";
    readonly CapaActionAdded: "quality.capa.action-added";
    readonly CapaActionCompleted: "quality.capa.action-completed";
    readonly CapaEffectivenessRecorded: "quality.capa.effectiveness-recorded";
    readonly CapaClosed: "quality.capa.closed";
    readonly CapaCancelled: "quality.capa.cancelled";
    readonly SupplierQualityEventRecorded: "quality.supplier-event.recorded";
    readonly ScarIssued: "quality.supplier-event.scar-issued";
    readonly ScarResponseRecorded: "quality.supplier-event.scar-response-recorded";
    readonly SupplierQualityEventResolved: "quality.supplier-event.resolved";
    readonly AuditTemplateActivated: "quality.audit-template.activated";
    readonly AuditPlanned: "quality.audit.planned";
    readonly AuditStarted: "quality.audit.started";
    readonly AuditFindingRecorded: "quality.audit.finding-recorded";
    readonly AuditCompleted: "quality.audit.completed";
    readonly AuditClosed: "quality.audit.closed";
};
export type QualityEventType = (typeof QualityEventTypes)[keyof typeof QualityEventTypes];
export interface InspectionLotDecidedPayload {
    lotNumber: string;
    planId: Ulid;
    origin: string;
    materialCode: string;
    decision: string;
    acceptedQuantity: number;
    rejectedQuantity: number;
    supplierId?: string;
    purchaseOrderRef?: string;
    workOrderRef?: string;
    failedCharacteristicCodes: string[];
}
export interface NcrOpenedPayload {
    ncrNumber: string;
    source: string;
    severity: string;
    inspectionLotId?: Ulid;
    supplierId?: string;
    workOrderRef?: string;
    quantityAffected?: number;
}
export interface NcrDispositionedPayload {
    ncrNumber: string;
    dispositionType: string;
    requiresApproval: boolean;
    quantityAffected?: number;
}
export interface CapaStateChangedPayload {
    capaNumber: string;
    fromState: string;
    toState: string;
}
export interface SupplierQualityEventRecordedPayload {
    supplierId: string;
    eventType: string;
    severity: string;
    demeritPoints: number;
    ncrId?: Ulid;
    capaId?: Ulid;
    inspectionLotId?: Ulid;
    auditId?: Ulid;
}
export interface AuditCompletedPayload {
    auditNumber: string;
    auditType: string;
    scorePercent: number;
    outcome: string;
    findingCounts: {
        observation: number;
        ofi: number;
        minorNc: number;
        majorNc: number;
    };
    supplierId?: string;
}
//# sourceMappingURL=events.d.ts.map
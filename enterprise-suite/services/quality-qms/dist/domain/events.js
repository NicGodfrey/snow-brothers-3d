export const QualityEventTypes = {
    // Inspection plans
    InspectionPlanCreated: "quality.inspection-plan.created",
    InspectionPlanActivated: "quality.inspection-plan.activated",
    InspectionPlanRetired: "quality.inspection-plan.retired",
    InspectionPlanRevised: "quality.inspection-plan.revised",
    // Inspection lots
    InspectionLotCreated: "quality.inspection-lot.created",
    InspectionLotStarted: "quality.inspection-lot.started",
    InspectionResultRecorded: "quality.inspection-lot.result-recorded",
    InspectionLotCompleted: "quality.inspection-lot.completed",
    InspectionLotDecided: "quality.inspection-lot.usage-decided",
    InspectionLotCancelled: "quality.inspection-lot.cancelled",
    // Non-conformance reports
    NcrCreated: "quality.ncr.created",
    NcrOpened: "quality.ncr.opened",
    NcrContainmentStarted: "quality.ncr.containment-started",
    NcrDispositioned: "quality.ncr.dispositioned",
    NcrDispositionApproved: "quality.ncr.disposition-approved",
    NcrClosed: "quality.ncr.closed",
    NcrCancelled: "quality.ncr.cancelled",
    NcrEscalatedToCapa: "quality.ncr.escalated-to-capa",
    // CAPA
    CapaCreated: "quality.capa.created",
    CapaStateChanged: "quality.capa.state-changed",
    CapaActionAdded: "quality.capa.action-added",
    CapaActionCompleted: "quality.capa.action-completed",
    CapaEffectivenessRecorded: "quality.capa.effectiveness-recorded",
    CapaClosed: "quality.capa.closed",
    CapaCancelled: "quality.capa.cancelled",
    // Supplier quality
    SupplierQualityEventRecorded: "quality.supplier-event.recorded",
    ScarIssued: "quality.supplier-event.scar-issued",
    ScarResponseRecorded: "quality.supplier-event.scar-response-recorded",
    SupplierQualityEventResolved: "quality.supplier-event.resolved",
    // Audits
    AuditTemplateActivated: "quality.audit-template.activated",
    AuditPlanned: "quality.audit.planned",
    AuditStarted: "quality.audit.started",
    AuditFindingRecorded: "quality.audit.finding-recorded",
    AuditCompleted: "quality.audit.completed",
    AuditClosed: "quality.audit.closed",
};
//# sourceMappingURL=events.js.map
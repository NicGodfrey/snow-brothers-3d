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
} as const;

export type QualityEventType =
  (typeof QualityEventTypes)[keyof typeof QualityEventTypes];

// ---------------------------------------------------------------------------
// Payload shapes (the contract other contexts consume)
// ---------------------------------------------------------------------------

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
  findingCounts: { observation: number; ofi: number; minorNc: number; majorNc: number };
  supplierId?: string;
}

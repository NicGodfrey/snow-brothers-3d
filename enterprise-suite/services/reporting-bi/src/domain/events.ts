/**
 * Event catalog for the reporting-bi bounded context.
 *
 * Reporting is mostly a *consumer* of domain events, but it publishes a few
 * of its own: catalog changes (so a downstream semantic-layer cache can
 * invalidate), KPI threshold breaches (so alerting can page someone), and
 * export job lifecycle (so a UI can offer a download link).
 *
 * All of them travel through the transactional outbox as shared-kernel
 * `EventEnvelope`s.
 */
import type { Ulid } from "@enterprise-suite/shared-kernel";

export const ReportingEventTypes = {
  // Semantic layer
  MetricDefined: "reporting.metric.defined",
  MetricUpdated: "reporting.metric.updated",
  MetricPublished: "reporting.metric.published",
  MetricDeprecated: "reporting.metric.deprecated",
  DimensionRegistered: "reporting.dimension.registered",
  DimensionMembersLoaded: "reporting.dimension.members-loaded",
  CubeDefined: "reporting.cube.defined",
  CubePublished: "reporting.cube.published",
  CubeArchived: "reporting.cube.archived",

  // Fact ingest
  FactsIngested: "reporting.facts.ingested",
  FactsRejected: "reporting.facts.rejected",
  FactsPurged: "reporting.facts.purged",

  // KPI & dashboards
  KpiDefined: "reporting.kpi.defined",
  KpiSnapshotComputed: "reporting.kpi.snapshot-computed",
  KpiThresholdBreached: "reporting.kpi.threshold-breached",
  KpiRecovered: "reporting.kpi.recovered",
  DashboardCreated: "reporting.dashboard.created",
  DashboardPublished: "reporting.dashboard.published",
  DashboardArchived: "reporting.dashboard.archived",

  // Exports
  ExportRequested: "reporting.export.requested",
  ExportStarted: "reporting.export.started",
  ExportCompleted: "reporting.export.completed",
  ExportFailed: "reporting.export.failed",
  ExportCancelled: "reporting.export.cancelled",
} as const;

export type ReportingEventType =
  (typeof ReportingEventTypes)[keyof typeof ReportingEventTypes];

// ---------------------------------------------------------------------------
// Payload shapes consumed outside this context
// ---------------------------------------------------------------------------

export interface MetricPublishedPayload {
  code: string;
  cube: string;
  kind: string;
}

export interface FactsIngestedPayload {
  cube: string;
  /** Bounded context the source events came from, e.g. "sales". */
  source: string;
  eventCount: number;
  factCount: number;
  duplicateCount: number;
  rejectedCount: number;
  /** Latest source-event instant now visible to queries. */
  watermark: string;
}

export interface FactsRejectedPayload {
  source: string;
  reason: string;
  eventType: string;
  eventId: Ulid;
  message: string;
}

export interface KpiSnapshotComputedPayload {
  kpiCode: string;
  period: string;
  value: number | null;
  previousValue: number | null;
  targetValue: number | null;
  status: string;
}

export interface KpiThresholdBreachedPayload {
  kpiCode: string;
  period: string;
  value: number | null;
  targetValue: number | null;
  /** "warning" or "critical" — matches the crossed threshold band. */
  severity: string;
  previousStatus: string;
}

export interface ExportCompletedPayload {
  jobNumber: string;
  format: string;
  rowCount: number;
  byteSize: number;
  artifactKey: string;
  checksum: string;
  expiresAt?: string;
}

export interface ExportFailedPayload {
  jobNumber: string;
  format: string;
  errorCode: string;
  message: string;
}

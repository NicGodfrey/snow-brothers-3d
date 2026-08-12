/**
 * Aggregate → JSON views.
 *
 * Aggregates keep their state private and expose behaviour, so the HTTP layer
 * needs an explicit projection rather than `JSON.stringify(aggregate)`. That
 * indirection is worth having anyway: the wire format is a published contract
 * and should not change silently when an internal field is renamed.
 */
import type { CubeDefinition } from "../domain/cube.js";
import type { Dashboard, DashboardTile } from "../domain/dashboard.js";
import type { Dimension, DimensionMember } from "../domain/dimension.js";
import type { ExportJob } from "../domain/export-job.js";
import type { KpiDefinition } from "../domain/kpi.js";
import type { MetricDefinition } from "../domain/metric.js";

export function metricDto(metric: MetricDefinition) {
  return {
    id: metric.id,
    code: metric.code,
    name: metric.name,
    description: metric.description,
    cube: metric.cube,
    kind: metric.kind,
    unit: metric.unit,
    direction: metric.direction,
    status: metric.status,
    decimals: metric.decimals,
    aggregation: metric.aggregation,
    sourceField: metric.sourceField,
    expression: metric.expression,
    dependsOn: metric.dependencies(),
    tags: metric.tags,
    version: metric.version,
    updatedAt: metric.updatedAt,
  };
}

export function dimensionDto(dimension: Dimension) {
  return {
    id: dimension.id,
    key: dimension.key,
    label: dimension.label,
    description: dimension.description,
    type: dimension.type,
    levels: dimension.levels.map((level) => ({ ...level })),
    leafLevel: dimension.leafLevel.key,
    memberCount: dimension.memberCount,
    version: dimension.version,
    updatedAt: dimension.updatedAt,
  };
}

export function memberDto(member: DimensionMember) {
  return {
    key: member.key,
    label: member.label,
    levelKey: member.levelKey,
    parentKey: member.parentKey,
    attributes: member.attributes,
  };
}

export function cubeDto(cube: CubeDefinition) {
  return {
    id: cube.id,
    name: cube.name,
    title: cube.title,
    description: cube.description,
    status: cube.status,
    defaultGrain: cube.defaultGrain,
    retentionDays: cube.retentionDays,
    dimensions: cube.dimensions.map((binding) => ({ ...binding })),
    measureFields: cube.measureFields.map((measure) => ({ ...measure })),
    sourceEventTypes: cube.sourceEventTypes,
    defaultMetrics: cube.defaultMetrics,
    version: cube.version,
    updatedAt: cube.updatedAt,
  };
}

export function kpiDto(kpi: KpiDefinition) {
  return {
    id: kpi.id,
    code: kpi.code,
    name: kpi.name,
    description: kpi.description,
    cube: kpi.cube,
    metricCode: kpi.metricCode,
    unit: kpi.unit,
    direction: kpi.direction,
    grain: kpi.grain,
    filters: kpi.filters,
    target: kpi.target,
    thresholds: kpi.thresholds,
    sparklinePeriods: kpi.sparklinePeriods,
    owner: kpi.owner,
    active: kpi.active,
    version: kpi.version,
    updatedAt: kpi.updatedAt,
  };
}

export function tileDto(tile: DashboardTile) {
  return {
    id: tile.id,
    type: tile.type,
    title: tile.title,
    layout: tile.layout,
    window: tile.window,
    kpiCode: tile.kpiCode,
    query: tile.query,
    chart: tile.chart,
  };
}

export function dashboardDto(dashboard: Dashboard) {
  return {
    id: dashboard.id,
    code: dashboard.code,
    title: dashboard.title,
    description: dashboard.description,
    status: dashboard.status,
    audienceRoles: dashboard.audienceRoles,
    refreshIntervalSeconds: dashboard.refreshIntervalSeconds,
    tiles: dashboard.tiles.map(tileDto),
    version: dashboard.version,
    updatedAt: dashboard.updatedAt,
  };
}

export function exportJobDto(job: ExportJob) {
  return {
    id: job.id,
    jobNumber: job.jobNumber,
    format: job.format,
    kind: job.request.kind,
    request: job.request,
    status: job.status,
    requestedBy: job.requestedBy,
    requestedAt: job.requestedAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    durationMs: job.durationMs(),
    attempts: job.attempts,
    rowCount: job.rowCount,
    byteSize: job.byteSize,
    checksum: job.checksum,
    artifactKey: job.artifactKey,
    expiresAt: job.expiresAt,
    error: job.error,
  };
}

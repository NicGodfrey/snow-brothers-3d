/**
 * Composition root: wires repositories, ports, the mapping registry and the
 * application services into one module. Tests and the HTTP server both build
 * on this, so there is exactly one description of how the service fits
 * together.
 */
import { CubeService } from "../application/cube-service.js";
import { DashboardService } from "../application/dashboard-service.js";
import { DimensionService } from "../application/dimension-service.js";
import { ExportService, type ExportServiceOptions } from "../application/export-service.js";
import { IngestService } from "../application/ingest-service.js";
import { KpiService } from "../application/kpi-service.js";
import { standardMappings } from "../application/mappings.js";
import { MetricService } from "../application/metric-service.js";
import type { Clock } from "../application/ports.js";
import { QueryService } from "../application/query-service.js";
import { MappingRegistry, type FactMapping } from "../domain/ingest.js";
import { InMemoryBlobStore } from "./in-memory/blob-store.js";
import { SystemClock } from "./in-memory/clock.js";
import { InMemoryNumberSeries } from "./in-memory/number-series.js";
import { InMemoryOutbox } from "./in-memory/outbox.js";
import {
  InMemoryCubeRepository,
  InMemoryDashboardRepository,
  InMemoryDeadLetterRepository,
  InMemoryDimensionRepository,
  InMemoryExportJobRepository,
  InMemoryFactRepository,
  InMemoryKpiRepository,
  InMemoryKpiSnapshotRepository,
  InMemoryMetricRepository,
  InMemoryWatermarkRepository,
} from "./in-memory/repositories.js";

export interface ReportingBiModuleOptions {
  clock?: Clock;
  /** Replaces the standard mapping catalog entirely. */
  mappings?: readonly FactMapping[];
  /** Extra mappings layered on top of the standard catalog. */
  additionalMappings?: readonly FactMapping[];
  queryCacheSize?: number;
  exports?: ExportServiceOptions;
}

export interface ReportingBiModule {
  clock: Clock;
  outbox: InMemoryOutbox;
  blobs: InMemoryBlobStore;
  registry: MappingRegistry;
  repos: {
    metrics: InMemoryMetricRepository;
    dimensions: InMemoryDimensionRepository;
    cubes: InMemoryCubeRepository;
    facts: InMemoryFactRepository;
    deadLetters: InMemoryDeadLetterRepository;
    watermarks: InMemoryWatermarkRepository;
    kpis: InMemoryKpiRepository;
    snapshots: InMemoryKpiSnapshotRepository;
    dashboards: InMemoryDashboardRepository;
    exports: InMemoryExportJobRepository;
  };
  services: {
    metrics: MetricService;
    dimensions: DimensionService;
    cubes: CubeService;
    ingest: IngestService;
    queries: QueryService;
    kpis: KpiService;
    dashboards: DashboardService;
    exports: ExportService;
  };
}

export function createReportingBiModule(options?: ReportingBiModuleOptions): ReportingBiModule {
  const clock = options?.clock ?? new SystemClock();
  const outbox = new InMemoryOutbox();
  const blobs = new InMemoryBlobStore(clock);
  const numbers = new InMemoryNumberSeries(clock);

  const registry = new MappingRegistry();
  registry.registerAll(options?.mappings ?? standardMappings());
  if (options?.additionalMappings) {
    for (const mapping of options.additionalMappings) registry.override(mapping);
  }

  const repos = {
    metrics: new InMemoryMetricRepository(),
    dimensions: new InMemoryDimensionRepository(),
    cubes: new InMemoryCubeRepository(),
    facts: new InMemoryFactRepository(),
    deadLetters: new InMemoryDeadLetterRepository(),
    watermarks: new InMemoryWatermarkRepository(),
    kpis: new InMemoryKpiRepository(),
    snapshots: new InMemoryKpiSnapshotRepository(),
    dashboards: new InMemoryDashboardRepository(),
    exports: new InMemoryExportJobRepository(),
  };

  const metrics = new MetricService(repos.metrics, repos.cubes, outbox);
  const dimensions = new DimensionService(repos.dimensions, outbox);
  const cubes = new CubeService(repos.cubes, repos.metrics, repos.dimensions, repos.facts, outbox);
  const ingest = new IngestService(
    repos.facts,
    repos.cubes,
    repos.deadLetters,
    repos.watermarks,
    registry,
    outbox,
    clock,
  );
  const queries = new QueryService(repos.facts, repos.cubes, metrics, dimensions, clock, {
    cacheSize: options?.queryCacheSize,
  });
  const kpis = new KpiService(repos.kpis, repos.snapshots, queries, outbox, clock);
  const dashboards = new DashboardService(repos.dashboards, queries, kpis, outbox, clock);
  const exports = new ExportService(
    repos.exports,
    blobs,
    queries,
    kpis,
    repos.facts,
    repos.cubes,
    outbox,
    numbers,
    clock,
    options?.exports,
  );

  return {
    clock,
    outbox,
    blobs,
    registry,
    repos,
    services: { metrics, dimensions, cubes, ingest, queries, kpis, dashboards, exports },
  };
}

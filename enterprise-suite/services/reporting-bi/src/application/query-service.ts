/**
 * Query execution: resolve the catalog, scan facts, run the engine.
 *
 * A small result cache sits in front of the engine. Dashboards fire the same
 * handful of queries every refresh for every viewer, so caching on the
 * (tenant, query, fact-version) triple removes almost all repeated work while
 * still invalidating the instant new facts land — the fact count and latest
 * instant are part of the key, so a stale hit is not possible.
 */
import { NotFoundError, type TenantContext } from "@enterprise-suite/shared-kernel";
import { executeQuery, type AggregationContext } from "../domain/aggregation.js";
import { parseDimensionRef } from "../domain/dimension.js";
import { QueryError } from "../domain/errors.js";
import type { MetricDefinition } from "../domain/metric.js";
import {
  normalizeQuery,
  type CubeQuery,
  type CubeQueryInput,
  type CubeQueryResult,
} from "../domain/query.js";
import type { CubeRepository, FactRepository } from "../domain/repositories.js";
import { comparisonRange } from "../domain/time-grain.js";
import type { DimensionService } from "./dimension-service.js";
import type { MetricService } from "./metric-service.js";
import type { Clock } from "./ports.js";

interface CacheEntry {
  readonly key: string;
  readonly result: CubeQueryResult;
}

export interface QueryServiceOptions {
  /** 0 disables caching (tests that assert engine calls). */
  readonly cacheSize?: number;
}

export class QueryService {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly cacheSize: number;

  constructor(
    private readonly facts: FactRepository,
    private readonly cubes: CubeRepository,
    private readonly metricService: MetricService,
    private readonly dimensionService: DimensionService,
    private readonly clock: Clock,
    options?: QueryServiceOptions,
  ) {
    this.cacheSize = options?.cacheSize ?? 64;
  }

  async run(ctx: TenantContext, input: CubeQueryInput): Promise<CubeQueryResult> {
    const query = normalizeQuery(input);
    const cube = await this.cubes.findByName(ctx.tenantId, query.cube);
    if (!cube) throw new NotFoundError("Cube", query.cube);

    const metrics = await this.metricService.resolveForQuery(ctx, query.cube, query.metrics);
    this.assertDimensionsExist(query, cube.dimensions.map((d) => d.factKey));

    const cacheKey = await this.cacheKey(ctx, query);
    const cached = this.cacheSize > 0 ? this.cache.get(cacheKey) : undefined;
    if (cached) return cached.result;

    const dimensions = await this.dimensionService.catalog(ctx);
    const scanned = await this.scanFacts(ctx, query);

    const context: AggregationContext = {
      cube,
      metrics,
      dimensions,
      now: this.clock.now(),
    };
    const result = executeQuery(scanned, query, context);
    this.remember(cacheKey, result);
    return result;
  }

  /**
   * Runs a query and returns it with the metric definitions used, which is
   * what CSV rendering needs to format values by unit.
   */
  async runWithMetrics(
    ctx: TenantContext,
    input: CubeQueryInput,
  ): Promise<{ result: CubeQueryResult; metrics: Map<string, MetricDefinition> }> {
    const result = await this.run(ctx, input);
    const definitions = await this.metricService.resolveForQuery(
      ctx,
      input.cube,
      result.columns.filter((c) => c.kind === "metric").map((c) => c.key),
    );
    return { result, metrics: new Map(definitions.map((m) => [m.code, m])) };
  }

  /** Single-number answer, e.g. for KPI computation. */
  async scalar(
    ctx: TenantContext,
    input: Omit<CubeQueryInput, "dimensions" | "metrics"> & { metric: string },
  ): Promise<number | null> {
    const result = await this.run(ctx, {
      ...input,
      metrics: [input.metric],
      dimensions: [],
      timeGrain: undefined,
      includeTotals: true,
      limit: 1,
    });
    return result.totals[input.metric] ?? null;
  }

  invalidate(): void {
    this.cache.clear();
  }

  /**
   * Facts the query can possibly touch. When a comparison is requested the
   * scan widens to cover both windows in one pass.
   */
  private async scanFacts(ctx: TenantContext, query: CubeQuery) {
    let from = query.timeRange?.from;
    let toExclusive = query.timeRange?.toExclusive;
    if (query.compareTo && query.timeRange) {
      const shifted = comparisonRange(query.timeRange, query.timeGrain ?? "day", query.compareTo);
      from = shifted.from < query.timeRange.from ? shifted.from : query.timeRange.from;
      toExclusive =
        shifted.toExclusive > query.timeRange.toExclusive
          ? shifted.toExclusive
          : query.timeRange.toExclusive;
    }
    return this.facts.scan(ctx.tenantId, { cube: query.cube, from, toExclusive });
  }

  private assertDimensionsExist(query: CubeQuery, available: readonly string[]): void {
    const refs = [...query.dimensions, ...query.filters.map((f) => f.dimension)];
    for (const ref of refs) {
      const { dimensionKey } = parseDimensionRef(ref);
      if (!available.includes(dimensionKey)) {
        throw new QueryError(
          `cube '${query.cube}' has no dimension '${dimensionKey}'`,
          { available },
        );
      }
    }
  }

  private async cacheKey(ctx: TenantContext, query: CubeQuery): Promise<string> {
    const [count, latest] = await Promise.all([
      this.facts.count(ctx.tenantId, query.cube),
      this.facts.latestOccurredAt(ctx.tenantId, query.cube),
    ]);
    return JSON.stringify([ctx.tenantId, query, count, latest]);
  }

  private remember(key: string, result: CubeQueryResult): void {
    if (this.cacheSize === 0) return;
    if (this.cache.size >= this.cacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { key, result });
  }
}

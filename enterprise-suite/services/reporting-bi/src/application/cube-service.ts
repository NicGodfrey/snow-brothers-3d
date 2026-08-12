/**
 * Cube catalog use-cases plus the "describe" view that a query builder UI
 * needs: schema, available metrics, hierarchy levels, and freshness.
 */
import {
  ConflictError,
  NotFoundError,
  type IsoDateTime,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { CubeDefinition, type CubeStatus, type DefineCubeInput } from "../domain/cube.js";
import type {
  CubeRepository,
  DimensionRepository,
  FactRepository,
  MetricRepository,
} from "../domain/repositories.js";
import { TIME_GRAINS, type TimeGrain } from "../domain/time-grain.js";
import type { Outbox } from "./ports.js";

export interface CubeDescription {
  readonly name: string;
  readonly title: string;
  readonly description?: string;
  readonly status: CubeStatus;
  readonly defaultGrain: TimeGrain;
  readonly grains: readonly TimeGrain[];
  readonly dimensions: readonly {
    readonly key: string;
    readonly label: string;
    readonly required: boolean;
    readonly dimensionKey: string;
    readonly levels: readonly { key: string; label: string; ref: string }[];
    readonly memberCount: number;
  }[];
  readonly measureFields: readonly { field: string; label: string; isCurrency: boolean }[];
  readonly metrics: readonly {
    readonly code: string;
    readonly name: string;
    readonly kind: string;
    readonly unit: string;
    readonly status: string;
    readonly expression?: string;
    readonly aggregation?: string;
  }[];
  readonly sourceEventTypes: readonly string[];
  readonly factCount: number;
  readonly latestFactAt: IsoDateTime | null;
  readonly defaultMetrics: readonly string[];
}

export class CubeService {
  constructor(
    private readonly cubes: CubeRepository,
    private readonly metrics: MetricRepository,
    private readonly dimensions: DimensionRepository,
    private readonly facts: FactRepository,
    private readonly outbox: Outbox,
  ) {}

  async defineCube(ctx: TenantContext, input: DefineCubeInput): Promise<CubeDefinition> {
    const existing = await this.cubes.findByName(ctx.tenantId, input.name);
    if (existing) throw new ConflictError(`cube '${input.name}' already exists`);
    const cube = CubeDefinition.define(ctx.tenantId, input);
    await this.flush(cube);
    return cube;
  }

  async getCube(ctx: TenantContext, name: string): Promise<CubeDefinition> {
    const cube = await this.cubes.findByName(ctx.tenantId, name);
    if (!cube) throw new NotFoundError("Cube", name);
    return cube;
  }

  async listCubes(ctx: TenantContext, filter?: { status?: CubeStatus }): Promise<CubeDefinition[]> {
    return this.cubes.list(ctx.tenantId, filter);
  }

  async addDimension(
    ctx: TenantContext,
    name: string,
    input: { factKey: string; dimensionKey?: string; label?: string; required?: boolean },
  ): Promise<CubeDefinition> {
    const cube = await this.getCube(ctx, name);
    cube.addDimension(input);
    await this.flush(cube);
    return cube;
  }

  async addMeasureField(
    ctx: TenantContext,
    name: string,
    input: { field: string; label?: string; isCurrency?: boolean },
  ): Promise<CubeDefinition> {
    const cube = await this.getCube(ctx, name);
    cube.addMeasureField(input);
    await this.flush(cube);
    return cube;
  }

  async publishCube(ctx: TenantContext, name: string): Promise<CubeDefinition> {
    const cube = await this.getCube(ctx, name);
    cube.publish();
    await this.flush(cube);
    return cube;
  }

  async archiveCube(ctx: TenantContext, name: string, reason: string): Promise<CubeDefinition> {
    const cube = await this.getCube(ctx, name);
    cube.archive(reason);
    await this.flush(cube);
    return cube;
  }

  /** Everything a client needs to build a valid query against this cube. */
  async describe(ctx: TenantContext, name: string): Promise<CubeDescription> {
    const cube = await this.getCube(ctx, name);
    const [metrics, factCount, latestFactAt] = await Promise.all([
      this.metrics.list(ctx.tenantId, { cube: name }),
      this.facts.count(ctx.tenantId, name),
      this.facts.latestOccurredAt(ctx.tenantId, name),
    ]);

    const dimensions = [];
    for (const binding of cube.dimensions) {
      const dimension = await this.dimensions.findByKey(ctx.tenantId, binding.dimensionKey);
      dimensions.push({
        key: binding.factKey,
        label: binding.label,
        required: binding.required,
        dimensionKey: binding.dimensionKey,
        levels: (dimension?.levels ?? []).map((level) => ({
          key: level.key,
          label: level.label,
          ref:
            dimension && level.key === dimension.leafLevel.key
              ? binding.factKey
              : `${binding.factKey}.${level.key}`,
        })),
        memberCount: dimension?.memberCount ?? 0,
      });
    }

    return {
      name: cube.name,
      title: cube.title,
      description: cube.description,
      status: cube.status,
      defaultGrain: cube.defaultGrain,
      grains: TIME_GRAINS,
      dimensions,
      measureFields: cube.measureFields.map((m) => ({ ...m })),
      metrics: metrics.map((metric) => ({
        code: metric.code,
        name: metric.name,
        kind: metric.kind,
        unit: metric.unit,
        status: metric.status,
        expression: metric.expression,
        aggregation: metric.aggregation,
      })),
      sourceEventTypes: cube.sourceEventTypes,
      factCount,
      latestFactAt,
      defaultMetrics: cube.defaultMetrics,
    };
  }

  private async flush(cube: CubeDefinition): Promise<void> {
    await this.cubes.save(cube);
    await this.outbox.append(cube.pullEvents());
  }
}

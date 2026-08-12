/**
 * Metric catalog use-cases.
 *
 * Definition-time validation is aggressive on purpose: a metric whose
 * source field does not exist on its cube silently returns null forever,
 * and nobody notices until a board pack is wrong. Better to reject it when
 * someone is looking at the error message.
 */
import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import type { CubeDefinition } from "../domain/cube.js";
import { DefinitionError } from "../domain/errors.js";
import {
  MetricDefinition,
  resolveEvaluationOrder,
  type Aggregation,
  type DefineMetricInput,
  type MetricDirection,
  type MetricStatus,
  type MetricUnit,
} from "../domain/metric.js";
import type { CubeRepository, MetricRepository } from "../domain/repositories.js";
import type { Outbox } from "./ports.js";

export interface UpdateMetricInput {
  name?: string;
  description?: string;
  unit?: MetricUnit;
  direction?: MetricDirection;
  decimals?: number;
  aggregation?: Aggregation;
  sourceField?: string;
  expression?: string;
  tags?: readonly string[];
}

export class MetricService {
  constructor(
    private readonly metrics: MetricRepository,
    private readonly cubes: CubeRepository,
    private readonly outbox: Outbox,
  ) {}

  async defineMetric(ctx: TenantContext, input: DefineMetricInput): Promise<MetricDefinition> {
    const existing = await this.metrics.findByCode(ctx.tenantId, input.code);
    if (existing) {
      throw new ConflictError(`metric '${input.code}' already exists in this tenant`);
    }
    const cube = await this.requireCube(ctx.tenantId, input.cube);
    const metric = MetricDefinition.define(ctx.tenantId, input);
    await this.assertConsistent(ctx.tenantId, metric, cube);
    await this.flush(metric);
    return metric;
  }

  async updateMetric(
    ctx: TenantContext,
    code: string,
    input: UpdateMetricInput,
  ): Promise<MetricDefinition> {
    const metric = await this.getMetric(ctx, code);
    metric.redefine(input);
    const cube = await this.requireCube(ctx.tenantId, metric.cube);
    await this.assertConsistent(ctx.tenantId, metric, cube);
    await this.flush(metric);
    return metric;
  }

  async publishMetric(ctx: TenantContext, code: string): Promise<MetricDefinition> {
    const metric = await this.getMetric(ctx, code);
    // A published metric must not depend on drafts, or a dashboard pinned to
    // published definitions would read through to unstable ones.
    for (const dependency of metric.dependencies()) {
      const target = await this.metrics.findByCode(ctx.tenantId, dependency);
      if (!target) throw new DefinitionError(`metric '${code}' references unknown '${dependency}'`);
      if (target.status !== "published") {
        throw new ConflictError(
          `metric '${code}' cannot be published while its dependency '${dependency}' is ${target.status}`,
        );
      }
    }
    metric.publish();
    await this.flush(metric);
    return metric;
  }

  async deprecateMetric(ctx: TenantContext, code: string, reason: string): Promise<MetricDefinition> {
    const metric = await this.getMetric(ctx, code);
    // Already-deprecated dependents do not block: they are on their way out
    // too, and requiring a particular deprecation order would make retiring
    // a whole family of metrics impossible.
    const dependents = (await this.metrics.list(ctx.tenantId, { cube: metric.cube })).filter(
      (candidate) =>
        candidate.code !== code &&
        candidate.status !== "deprecated" &&
        candidate.dependencies().includes(code),
    );
    if (dependents.length > 0) {
      throw new ConflictError(
        `metric '${code}' is used by ${dependents.map((d) => d.code).join(", ")}; deprecate those first`,
      );
    }
    metric.deprecate(reason);
    await this.flush(metric);
    return metric;
  }

  async getMetric(ctx: TenantContext, code: string): Promise<MetricDefinition> {
    const metric = await this.metrics.findByCode(ctx.tenantId, code);
    if (!metric) throw new NotFoundError("Metric", code);
    return metric;
  }

  async listMetrics(
    ctx: TenantContext,
    filter?: { cube?: string; status?: MetricStatus; tag?: string },
  ): Promise<MetricDefinition[]> {
    return this.metrics.list(ctx.tenantId, filter);
  }

  /**
   * Everything needed to evaluate `codes` on `cube`: the selected metrics
   * plus their transitive dependencies, ordered so evaluation is a single
   * forward pass.
   */
  async resolveForQuery(
    ctx: TenantContext,
    cube: string,
    codes: readonly string[],
  ): Promise<MetricDefinition[]> {
    const resolved = new Map<string, MetricDefinition>();
    const pending = [...codes];
    while (pending.length > 0) {
      const code = pending.shift()!;
      if (resolved.has(code)) continue;
      const metric = await this.metrics.findByCode(ctx.tenantId, code);
      if (!metric) {
        throw new NotFoundError("Metric", code);
      }
      if (metric.cube !== cube) {
        throw new DefinitionError(
          `metric '${code}' belongs to cube '${metric.cube}', not '${cube}'`,
        );
      }
      resolved.set(code, metric);
      pending.push(...metric.dependencies());
    }
    return [...resolveEvaluationOrder([...resolved.values()])];
  }

  /** Dependency graph of a cube's metrics, for catalog/lineage views. */
  async lineage(
    ctx: TenantContext,
    cube: string,
  ): Promise<{ code: string; kind: string; dependsOn: readonly string[]; usedBy: string[] }[]> {
    const metrics = await this.metrics.list(ctx.tenantId, { cube });
    return metrics.map((metric) => ({
      code: metric.code,
      kind: metric.kind,
      dependsOn: metric.dependencies(),
      usedBy: metrics.filter((other) => other.dependencies().includes(metric.code)).map((o) => o.code),
    }));
  }

  private async requireCube(tenantId: TenantId, name: string): Promise<CubeDefinition> {
    const cube = await this.cubes.findByName(tenantId, name);
    if (!cube) throw new NotFoundError("Cube", name);
    return cube;
  }

  /**
   * Cross-checks a metric against its cube: base metrics must aggregate a
   * declared measure field (or, for count_distinct, a declared dimension),
   * and derived metrics must only reference metrics of the same cube.
   */
  private async assertConsistent(
    tenantId: TenantId,
    metric: MetricDefinition,
    cube: CubeDefinition,
  ): Promise<void> {
    if (metric.kind === "base" && metric.sourceField) {
      const known =
        metric.aggregation === "count_distinct"
          ? cube.hasDimension(metric.sourceField) || cube.hasMeasureField(metric.sourceField)
          : cube.hasMeasureField(metric.sourceField);
      if (!known) {
        throw new DefinitionError(
          `metric '${metric.code}' reads '${metric.sourceField}', which cube '${cube.name}' does not declare`,
          {
            availableMeasures: cube.measureFields.map((m) => m.field),
            availableDimensions: cube.dimensions.map((d) => d.factKey),
          },
        );
      }
    }
    if (metric.kind === "derived") {
      const siblings = await this.metrics.list(tenantId, { cube: cube.name });
      const graph = [...siblings.filter((s) => s.code !== metric.code), metric];
      // Throws on unknown references and on cycles.
      resolveEvaluationOrder(graph);
    }
  }

  private async flush(metric: MetricDefinition): Promise<void> {
    await this.metrics.save(metric);
    await this.outbox.append(metric.pullEvents());
  }
}

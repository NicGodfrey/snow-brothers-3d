/**
 * Semantic-layer endpoints: dimensions, cubes and metrics.
 *
 * These three are grouped because they are one editorial surface — you cannot
 * add a metric without a cube, or group by a level without a dimension — and
 * a client building a query browser walks all three in a single pass.
 */
import type { CubeService } from "../../application/cube-service.js";
import type { DimensionService } from "../../application/dimension-service.js";
import type { MetricService } from "../../application/metric-service.js";
import { cubeDto, dimensionDto, memberDto, metricDto } from "../serializers.js";
import type { Router } from "../router.js";
import {
  cubeStatusValues,
  parseCubeDimension,
  parseCubeMeasure,
  parseDefineCube,
  parseDefineDimension,
  parseDefineMetric,
  parseMembers,
  parseMetricFilterQuery,
  parseReason,
  parseUpdateMetric,
  pathParam,
  queryEnum,
} from "../validation.js";

export function registerDimensionRoutes(router: Router, dimensions: DimensionService): void {
  router.get("/dimensions", async ({ ctx }) => ({
    body: { items: (await dimensions.listDimensions(ctx)).map(dimensionDto) },
  }));

  router.post("/dimensions", async ({ ctx, body }) => ({
    status: 201,
    body: dimensionDto(await dimensions.registerDimension(ctx, parseDefineDimension(body))),
  }));

  router.get("/dimensions/:key", async ({ ctx, params }) => ({
    body: dimensionDto(await dimensions.getDimension(ctx, pathParam(params, "key"))),
  }));

  /** Bulk member load; the service orders parents before children. */
  router.post("/dimensions/:key/members", async ({ ctx, params, body }) => {
    const { dimension, loaded } = await dimensions.loadMembers(
      ctx,
      pathParam(params, "key"),
      parseMembers(body),
    );
    return {
      body: {
        dimension: dimensionDto(dimension),
        loaded: loaded.length,
        memberCount: dimension.memberCount,
      },
    };
  });

  /** Members with their ancestor path — what a filter picker renders. */
  router.get("/dimensions/:key/members", async ({ ctx, params, query }) => {
    const rows = await dimensions.browse(
      ctx,
      pathParam(params, "key"),
      query.get("level") ?? undefined,
    );
    return {
      body: {
        items: rows.map((row) => ({ ...memberDto(row.member), path: row.path })),
        count: rows.length,
      },
    };
  });
}

export function registerCubeRoutes(
  router: Router,
  cubes: CubeService,
  metrics: MetricService,
): void {
  router.get("/cubes", async ({ ctx, query }) => ({
    body: {
      items: (
        await cubes.listCubes(ctx, { status: queryEnum(query, "status", cubeStatusValues) })
      ).map(cubeDto),
    },
  }));

  router.post("/cubes", async ({ ctx, body }) => ({
    status: 201,
    body: cubeDto(await cubes.defineCube(ctx, parseDefineCube(body))),
  }));

  router.get("/cubes/:name", async ({ ctx, params }) => ({
    body: cubeDto(await cubes.getCube(ctx, pathParam(params, "name"))),
  }));

  /** Schema + metrics + freshness: everything a query builder needs. */
  router.get("/cubes/:name/describe", async ({ ctx, params }) => ({
    body: await cubes.describe(ctx, pathParam(params, "name")),
  }));

  router.post("/cubes/:name/dimensions", async ({ ctx, params, body }) => ({
    body: cubeDto(
      await cubes.addDimension(ctx, pathParam(params, "name"), parseCubeDimension(body)),
    ),
  }));

  router.post("/cubes/:name/measures", async ({ ctx, params, body }) => ({
    body: cubeDto(
      await cubes.addMeasureField(ctx, pathParam(params, "name"), parseCubeMeasure(body)),
    ),
  }));

  router.post("/cubes/:name/publish", async ({ ctx, params }) => ({
    body: cubeDto(await cubes.publishCube(ctx, pathParam(params, "name"))),
  }));

  router.post("/cubes/:name/archive", async ({ ctx, params, body }) => ({
    body: cubeDto(await cubes.archiveCube(ctx, pathParam(params, "name"), parseReason(body))),
  }));

  /** Metric dependency graph of a cube, for lineage views. */
  router.get("/cubes/:name/lineage", async ({ ctx, params }) => ({
    body: { items: await metrics.lineage(ctx, pathParam(params, "name")) },
  }));
}

export function registerMetricRoutes(router: Router, metrics: MetricService): void {
  router.get("/metrics", async ({ ctx, query }) => ({
    body: {
      items: (await metrics.listMetrics(ctx, parseMetricFilterQuery(query))).map(metricDto),
    },
  }));

  router.post("/metrics", async ({ ctx, body }) => ({
    status: 201,
    body: metricDto(await metrics.defineMetric(ctx, parseDefineMetric(body))),
  }));

  router.get("/metrics/:code", async ({ ctx, params }) => ({
    body: metricDto(await metrics.getMetric(ctx, pathParam(params, "code"))),
  }));

  router.patch("/metrics/:code", async ({ ctx, params, body }) => ({
    body: metricDto(
      await metrics.updateMetric(ctx, pathParam(params, "code"), parseUpdateMetric(body)),
    ),
  }));

  router.post("/metrics/:code/publish", async ({ ctx, params }) => ({
    body: metricDto(await metrics.publishMetric(ctx, pathParam(params, "code"))),
  }));

  router.post("/metrics/:code/deprecate", async ({ ctx, params, body }) => ({
    body: metricDto(
      await metrics.deprecateMetric(ctx, pathParam(params, "code"), parseReason(body)),
    ),
  }));
}

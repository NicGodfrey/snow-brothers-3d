/**
 * HTTP server assembly over a ReportingBiModule.
 *
 * The router is built separately from the server so tests can dispatch
 * against it without binding a port.
 */
import { createServer, type Server } from "node:http";
import { installCatalog, standardCatalog } from "../infrastructure/catalog.js";
import type { ReportingBiModule } from "../infrastructure/module.js";
import { seedDemoData } from "../infrastructure/seed.js";
import { registerDashboardRoutes } from "./routes/dashboard-routes.js";
import {
  registerCubeRoutes,
  registerDimensionRoutes,
  registerMetricRoutes,
} from "./routes/catalog-routes.js";
import { registerExportRoutes } from "./routes/export-routes.js";
import { registerIngestRoutes } from "./routes/ingest-routes.js";
import { registerKpiRoutes } from "./routes/kpi-routes.js";
import { registerQueryRoutes } from "./routes/query-routes.js";
import { Router } from "./router.js";
import { queryInt } from "./validation.js";

export interface ServerOptions {
  /** Enables /admin/seed. Off unless a deployment explicitly asks for it. */
  readonly allowSeeding?: boolean;
}

export function buildRouter(module: ReportingBiModule, options?: ServerOptions): Router {
  const router = new Router();

  router.get("/health", () => ({
    body: { status: "ok", service: "reporting-bi", time: module.clock.now() },
  }));

  router.get("/", () => ({
    body: { service: "reporting-bi", routes: router.describe() },
  }));

  /** Catalog size and warehouse depth — the operator's first question. */
  router.get("/status", async ({ ctx }) => {
    const cubes = await module.repos.cubes.list(ctx.tenantId);
    const freshness = [];
    for (const cube of cubes) {
      freshness.push({
        cube: cube.name,
        status: cube.status,
        factCount: await module.repos.facts.count(ctx.tenantId, cube.name),
        latestFactAt: await module.repos.facts.latestOccurredAt(ctx.tenantId, cube.name),
      });
    }
    return {
      body: {
        service: "reporting-bi",
        time: module.clock.now(),
        counts: {
          dimensions: (await module.repos.dimensions.list(ctx.tenantId)).length,
          cubes: cubes.length,
          metrics: (await module.repos.metrics.list(ctx.tenantId)).length,
          kpis: (await module.repos.kpis.list(ctx.tenantId)).length,
          dashboards: (await module.repos.dashboards.list(ctx.tenantId)).length,
          facts: await module.repos.facts.count(ctx.tenantId),
          deadLetters: await module.repos.deadLetters.count(ctx.tenantId),
          pendingEvents: (await module.outbox.pending()).length,
        },
        cubes: freshness,
        watermarks: await module.repos.watermarks.list(ctx.tenantId),
      },
    };
  });

  /** Installs the shipped semantic layer. Idempotent per item. */
  router.post("/admin/install-catalog", async ({ ctx }) => ({
    body: await installCatalog(ctx, module, standardCatalog()),
  }));

  if (options?.allowSeeding) {
    router.post("/admin/seed", async ({ ctx, query }) => {
      const result = await seedDemoData(ctx, module, { days: queryInt(query, "days") ?? 120 });
      return {
        body: {
          events: result.events,
          factsWritten: result.ingest.factsWritten,
          rejected: result.ingest.rejected,
          snapshots: result.snapshots.length,
        },
      };
    });
  }

  /** Outbox inspection; a relay drains, everyone else peeks. */
  router.get("/outbox", async () => ({
    body: { items: await module.outbox.pending() },
  }));

  router.post("/outbox/drain", async () => {
    const events = await module.outbox.drain();
    return { body: { drained: events.length, items: events } };
  });

  registerDimensionRoutes(router, module.services.dimensions);
  registerCubeRoutes(router, module.services.cubes, module.services.metrics);
  registerMetricRoutes(router, module.services.metrics);
  registerIngestRoutes(router, module.services.ingest);
  registerQueryRoutes(router, module.services.queries);
  registerKpiRoutes(router, module.services.kpis);
  registerDashboardRoutes(router, module.services.dashboards);
  registerExportRoutes(router, module.services.exports);

  return router;
}

export function createReportingBiServer(module: ReportingBiModule, options?: ServerOptions): Server {
  const router = buildRouter(module, options);
  return createServer((req, res) => {
    void router.dispatch(req, res);
  });
}

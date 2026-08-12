/**
 * KPI endpoints: definitions, snapshots, scorecard.
 *
 * Snapshot computation is a POST because it writes: it stores the period's
 * value and can emit a threshold-breach event. Reading the last stored
 * snapshot is the GET on /history.
 */
import type { KpiService } from "../../application/kpi-service.js";
import { kpiDto } from "../serializers.js";
import type { Router } from "../router.js";
import {
  parseDefineKpi,
  parseFilters,
  parseRetarget,
  asObject,
  pathParam,
  queryBoolean,
  queryInstant,
  queryInt,
  queryList,
} from "../validation.js";

export function registerKpiRoutes(router: Router, kpis: KpiService): void {
  router.get("/kpis", async ({ ctx, query }) => ({
    body: {
      items: (
        await kpis.listKpis(ctx, {
          active: queryBoolean(query, "active"),
          cube: query.get("cube") ?? undefined,
        })
      ).map(kpiDto),
    },
  }));

  router.post("/kpis", async ({ ctx, body }) => ({
    status: 201,
    body: kpiDto(await kpis.defineKpi(ctx, parseDefineKpi(body))),
  }));

  router.get("/kpis/:code", async ({ ctx, params }) => ({
    body: kpiDto(await kpis.getKpi(ctx, pathParam(params, "code"))),
  }));

  router.patch("/kpis/:code/target", async ({ ctx, params, body }) => {
    const { target, thresholds } = parseRetarget(body);
    return {
      body: kpiDto(await kpis.retarget(ctx, pathParam(params, "code"), target, thresholds)),
    };
  });

  router.patch("/kpis/:code/filters", async ({ ctx, params, body }) => ({
    body: kpiDto(
      await kpis.refilter(ctx, pathParam(params, "code"), parseFilters(asObject(body)) ?? []),
    ),
  }));

  router.post("/kpis/:code/retire", async ({ ctx, params }) => ({
    body: kpiDto(await kpis.retire(ctx, pathParam(params, "code"))),
  }));

  /** Computes and stores the snapshot for the anchor's period. */
  router.post("/kpis/:code/snapshot", async ({ ctx, params, query }) => ({
    body: await kpis.computeSnapshot(ctx, pathParam(params, "code"), queryInstant(query, "at")),
  }));

  router.get("/kpis/:code/history", async ({ ctx, params, query }) => ({
    body: {
      items: await kpis.history(ctx, pathParam(params, "code"), queryInt(query, "limit") ?? 24),
    },
  }));

  /** Worst-first across every active KPI, or the `codes` subset. */
  router.get("/scorecard", async ({ ctx, query }) => {
    const entries = await kpis.scorecard(ctx, queryList(query, "codes"));
    return {
      body: {
        items: entries.map((entry) => entry.snapshot),
        needsAttention: entries.filter((entry) =>
          ["off-track", "at-risk"].includes(entry.snapshot.status),
        ).length,
      },
    };
  });

  /** Recomputes every active KPI — the scheduler's entry point. */
  router.post("/scorecard/recompute", async ({ ctx, query }) => {
    const snapshots = await kpis.computeAll(ctx, queryInstant(query, "at"));
    return { body: { computed: snapshots.length, items: snapshots } };
  });
}

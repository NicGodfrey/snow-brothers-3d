/**
 * Dashboard endpoints: definition CRUD plus rendering.
 *
 * `GET /dashboards/:code/render` is the interesting one — it resolves every
 * tile's relative window against the clock (or the `at` parameter, which is
 * what makes rendering reproducible in tests) and runs them. Tiles that fail
 * come back as error tiles with a 200 overall: a broken metric should grey
 * out one panel, not the page.
 */
import type { DashboardService } from "../../application/dashboard-service.js";
import { dashboardDto, tileDto } from "../serializers.js";
import type { Router } from "../router.js";
import {
  dashboardStatusValues,
  parseAddTile,
  parseCreateDashboard,
  parseReason,
  parseUpdateTile,
  pathParam,
  queryEnum,
  queryInstant,
  ulidParam,
} from "../validation.js";

export function registerDashboardRoutes(router: Router, dashboards: DashboardService): void {
  router.get("/dashboards", async ({ ctx, query }) => ({
    body: {
      items: (
        await dashboards.listDashboards(ctx, {
          status: queryEnum(query, "status", dashboardStatusValues),
        })
      ).map(dashboardDto),
    },
  }));

  router.post("/dashboards", async ({ ctx, body }) => ({
    status: 201,
    body: dashboardDto(await dashboards.createDashboard(ctx, parseCreateDashboard(body))),
  }));

  router.get("/dashboards/:code", async ({ ctx, params }) => ({
    body: dashboardDto(await dashboards.getDashboard(ctx, pathParam(params, "code"))),
  }));

  router.post("/dashboards/:code/tiles", async ({ ctx, params, body }) => ({
    status: 201,
    body: tileDto(await dashboards.addTile(ctx, pathParam(params, "code"), parseAddTile(body))),
  }));

  router.patch("/dashboards/:code/tiles/:tileId", async ({ ctx, params, body }) => ({
    body: tileDto(
      await dashboards.updateTile(
        ctx,
        pathParam(params, "code"),
        ulidParam(params, "tileId"),
        parseUpdateTile(body),
      ),
    ),
  }));

  router.delete("/dashboards/:code/tiles/:tileId", async ({ ctx, params }) => ({
    body: dashboardDto(
      await dashboards.removeTile(ctx, pathParam(params, "code"), ulidParam(params, "tileId")),
    ),
  }));

  router.post("/dashboards/:code/publish", async ({ ctx, params }) => ({
    body: dashboardDto(await dashboards.publishDashboard(ctx, pathParam(params, "code"))),
  }));

  router.post("/dashboards/:code/archive", async ({ ctx, params, body }) => ({
    body: dashboardDto(
      await dashboards.archiveDashboard(ctx, pathParam(params, "code"), parseReason(body)),
    ),
  }));

  router.get("/dashboards/:code/render", async ({ ctx, params, query }) => ({
    body: await dashboards.render(ctx, pathParam(params, "code"), queryInstant(query, "at")),
  }));

  /** One tile, for incremental refresh without re-running the whole page. */
  router.get("/dashboards/:code/tiles/:tileId/render", async ({ ctx, params, query, }) => {
    const dashboard = await dashboards.getDashboard(ctx, pathParam(params, "code"));
    const tileId = ulidParam(params, "tileId");
    const tile = dashboard.tile(tileId);
    if (!tile) {
      return {
        status: 404,
        body: { error: { code: "NOT_FOUND", message: `Tile not found: ${tileId}` } },
      };
    }
    const at = queryInstant(query, "at") ?? dashboards.now();
    return { body: await dashboards.renderTile(ctx, tile, at) };
  });
}

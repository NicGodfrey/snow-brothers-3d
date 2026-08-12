/**
 * Ad-hoc query endpoints.
 *
 * Queries are POSTed rather than encoded in a URL: a real query carries a
 * metric list, dimension refs, filters, a having clause and a window, which
 * does not survive a query string in any readable form — and a GET with a
 * 2 KB body of JSON in a parameter is worse than an honest POST.
 */
import type { QueryService } from "../../application/query-service.js";
import type { Router } from "../router.js";
import { parseCubeQuery, parseScalarQuery } from "../validation.js";

export function registerQueryRoutes(router: Router, queries: QueryService): void {
  router.post("/query", async ({ ctx, body }) => ({
    body: await queries.run(ctx, parseCubeQuery(body)),
  }));

  /** Single number for one metric — badges, tiles, alert rules. */
  router.post("/query/scalar", async ({ ctx, body }) => {
    const input = parseScalarQuery(body);
    const value = await queries.scalar(ctx, input);
    return { body: { cube: input.cube, metric: input.metric, value } };
  });
}

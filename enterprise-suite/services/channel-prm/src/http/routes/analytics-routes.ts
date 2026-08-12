import type { Ulid } from "@enterprise-suite/shared-kernel";
import type { AnalyticsQuery } from "../../application/analytics-service.js";
import type { CohortGranularity } from "../../domain/pipeline.js";
import { ValidationError } from "../../domain/errors.js";
import type { ChannelContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import { asRecord, isoFromQuery, numberFromQuery, optionalNumber } from "../validate.js";

function queryFrom(query: URLSearchParams): AnalyticsQuery {
  return {
    currency: query.get("currency") ?? undefined,
    partnerId: (query.get("partnerId") as Ulid | null) ?? undefined,
    at: isoFromQuery(query, "at"),
    from: isoFromQuery(query, "from"),
    to: isoFromQuery(query, "to"),
  };
}

export function registerAnalyticsRoutes(router: Router, container: ChannelContainer): void {
  const { services } = container;

  router.get("/analytics/pipeline", async (req) =>
    jsonResponse(200, await services.analytics.pipelineByStage(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/forecast", async (req) =>
    jsonResponse(200, await services.analytics.forecast(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/partners", async (req) =>
    jsonResponse(200, await services.analytics.pipelineByPartner(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/tiers", async (req) =>
    jsonResponse(200, await services.analytics.pipelineByTier(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/funnel", async (req) =>
    jsonResponse(200, await services.analytics.funnel(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/protection-expiry", async (req) =>
    jsonResponse(200, await services.analytics.protectionExpiry(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/source-split", async (req) =>
    jsonResponse(200, await services.analytics.sourceSplit(req.ctx, queryFrom(req.query))),
  );

  router.get("/analytics/cohorts", async (req) => {
    const granularity = (req.query.get("granularity") ?? "quarter") as CohortGranularity;
    if (granularity !== "month" && granularity !== "quarter") {
      throw ValidationError.single("granularity", 'must be "month" or "quarter"');
    }
    return jsonResponse(200, await services.analytics.cohorts(req.ctx, granularity, queryFrom(req.query)));
  });

  router.get("/analytics/scorecards", async (req) =>
    jsonResponse(200, {
      scorecards: await services.analytics.scorecards(req.ctx, {
        ...queryFrom(req.query),
        bookedValueTargetMinor: numberFromQuery(req.query, "targetMinor"),
      }),
    }),
  );

  router.get("/analytics/hygiene", async (req) =>
    jsonResponse(200, await services.analytics.hygiene(req.ctx, queryFrom(req.query))),
  );

  /** Drives the time-based transitions; a scheduler calls this. */
  router.post("/operations/expiry-sweep", async (req) => {
    const body = asRecord(req.body ?? {});
    return jsonResponse(200, await services.expiry.sweep(req.ctx, { noticeDays: optionalNumber(body, "noticeDays") }));
  });
}

import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  KPI_CATEGORIES,
  KPI_SOURCES,
  KPI_UNITS,
  type KpiCategory,
  type KpiDirection,
  type KpiSource,
  type KpiUnit,
} from "../../domain/kpi.js";
import { parsePeriod, PERIOD_KINDS, periodContaining, type PeriodKind } from "../../domain/period.js";
import { SUPPLIER_RATINGS, type ScorecardStatus } from "../../domain/scorecard.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalArray,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  optionalUserId,
  pageFromQuery,
  queryDate,
  queryEnum,
  queryId,
  queryNumber,
  requiredDate,
  requiredEnum,
  requiredId,
  requiredNumber,
  requiredString,
} from "../validate.js";

const DIRECTIONS = ["higher_better", "lower_better"] as const satisfies readonly KpiDirection[];

const SCORECARD_STATUSES = [
  "draft",
  "in_review",
  "published",
  "disputed",
  "closed",
] as const satisfies readonly ScorecardStatus[];

export function registerPerformanceRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  // --- KPI definitions -----------------------------------------------------

  router.post("/kpis", async (req) => {
    const body = asRecord(req.body);
    const kpi = await services.performance.createKpi(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      category: requiredEnum<KpiCategory>(body, "category", KPI_CATEGORIES),
      unit: requiredEnum<KpiUnit>(body, "unit", KPI_UNITS),
      direction: requiredEnum<KpiDirection>(body, "direction", DIRECTIONS),
      target: requiredNumber(body, "target"),
      floor: requiredNumber(body, "floor"),
      weight: requiredNumber(body, "weight"),
      description: optionalString(body, "description"),
      mandatory: optionalBoolean(body, "mandatory"),
      source: optionalEnum<KpiSource>(body, "source", KPI_SOURCES),
      greenScore: optionalNumber(body, "greenScore"),
      amberScore: optionalNumber(body, "amberScore"),
    });
    return jsonResponse(201, kpi);
  });

  router.get("/kpis", async (req) => jsonResponse(200, await services.performance.listKpis(req.ctx)));

  /** Installs the standard KPI catalog for a fresh tenant. */
  router.post("/kpis/seed-standard", async (req) =>
    jsonResponse(201, await services.performance.seedStandardKpis(req.ctx)),
  );

  router.patch("/kpis/:code", async (req) => {
    const body = asRecord(req.body);
    const kpi = await services.performance.updateKpi(req.ctx, req.params["code"]!, {
      name: optionalString(body, "name"),
      description: optionalString(body, "description"),
      category: optionalEnum<KpiCategory>(body, "category", KPI_CATEGORIES),
      unit: optionalEnum<KpiUnit>(body, "unit", KPI_UNITS),
      direction: optionalEnum<KpiDirection>(body, "direction", DIRECTIONS),
      target: optionalNumber(body, "target"),
      floor: optionalNumber(body, "floor"),
      weight: optionalNumber(body, "weight"),
      mandatory: optionalBoolean(body, "mandatory"),
      source: optionalEnum<KpiSource>(body, "source", KPI_SOURCES),
      greenScore: optionalNumber(body, "greenScore"),
      amberScore: optionalNumber(body, "amberScore"),
      isActive: optionalBoolean(body, "isActive"),
    });
    return jsonResponse(200, kpi);
  });

  // --- performance periods -------------------------------------------------

  /** Resolves a period code, or the period containing a date. */
  router.get("/periods/:code", (req) => jsonResponse(200, parsePeriod(req.params["code"]!)));

  router.get("/periods", (req) => {
    const kind = queryEnum<PeriodKind>(req.query, "kind", PERIOD_KINDS) ?? "quarter";
    const date = queryDate(req.query, "date") ?? container.clock.today();
    return jsonResponse(200, periodContaining(date, kind));
  });

  // --- scorecards ----------------------------------------------------------

  router.post("/scorecards", async (req) => {
    const body = asRecord(req.body);
    const scorecard = await services.performance.openScorecard(
      req.ctx,
      requiredId(body, "supplierId"),
      requiredString(body, "periodCode"),
    );
    return jsonResponse(201, scorecard.toJSON());
  });

  router.get("/scorecards", async (req) => {
    const page = await services.performance.listScorecards(
      req.ctx,
      {
        supplierId: queryId(req.query, "supplierId"),
        periodCode: req.query.get("periodCode") ?? undefined,
        status: queryEnum<ScorecardStatus>(req.query, "status", SCORECARD_STATUSES),
        rating: queryEnum(req.query, "rating", SUPPLIER_RATINGS),
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((entry) => entry.toJSON()) });
  });

  router.get("/scorecards/:id", async (req) =>
    jsonResponse(200, (await services.performance.getScorecard(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/scorecards/:id/measurements", async (req) => {
    const body = asRecord(req.body);
    const measurement = await services.performance.recordMeasurement(req.ctx, req.params["id"] as Ulid, {
      kpiCode: requiredString(body, "kpiCode"),
      value: requiredNumber(body, "value"),
      note: optionalString(body, "note"),
      source: optionalString(body, "source"),
    });
    return jsonResponse(201, measurement);
  });

  router.post("/scorecards/:id/submit", async (req) => {
    const body = asRecord(req.body ?? {});
    const scorecard = await services.performance.submitForReview(
      req.ctx,
      req.params["id"] as Ulid,
      optionalString(body, "note"),
    );
    return jsonResponse(200, scorecard.toJSON());
  });

  /**
   * Freezes the period, then pushes the same measured numbers through the
   * SLA commitments of the supplier's active contracts.
   */
  router.post("/scorecards/:id/publish", async (req) => {
    const result = await services.performance.publish(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, {
      score: result.score,
      rating: result.rating,
      slaBreaches: result.slaBreaches,
      scorecard: result.scorecard.toJSON(),
    });
  });

  router.post("/scorecards/:id/dispute", async (req) => {
    const body = asRecord(req.body);
    const scorecard = await services.performance.raiseDispute(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, scorecard.toJSON());
  });

  router.post("/scorecards/:id/dispute/resolve", async (req) => {
    const body = asRecord(req.body);
    const corrections = (optionalArray(body, "corrections") ?? []).map((raw) => {
      const entry = asRecord(raw);
      return {
        kpiCode: requiredString(entry, "kpiCode"),
        value: requiredNumber(entry, "value"),
        reason: requiredString(entry, "reason"),
      };
    });
    const scorecard = await services.performance.resolveDispute(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "resolution"),
      corrections,
    );
    return jsonResponse(200, scorecard.toJSON());
  });

  router.post("/scorecards/:id/actions", async (req) => {
    const body = asRecord(req.body);
    const action = await services.performance.addImprovementAction(req.ctx, req.params["id"] as Ulid, {
      title: requiredString(body, "title"),
      dueOn: requiredDate(body, "dueOn"),
      kpiCode: optionalString(body, "kpiCode"),
      ownerId: optionalUserId(body, "ownerId"),
    });
    return jsonResponse(201, action);
  });

  router.post("/scorecards/:id/actions/:actionId/complete", async (req) => {
    const body = asRecord(req.body);
    const action = await services.performance.completeImprovementAction(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["actionId"] as Ulid,
      requiredString(body, "outcome"),
    );
    return jsonResponse(200, action);
  });

  router.post("/scorecards/:id/close", async (req) =>
    jsonResponse(200, (await services.performance.closeScorecard(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  // --- analytics -----------------------------------------------------------

  router.get("/suppliers/:id/performance/trend", async (req) => {
    const periodCode = req.query.get("periodCode") ?? periodContaining(container.clock.today(), "quarter").code;
    const trend = await services.performance.trend(
      req.ctx,
      req.params["id"] as Ulid,
      periodCode,
      queryNumber(req.query, "count") ?? 4,
    );
    return jsonResponse(200, trend);
  });

  router.get("/performance/ranking/:periodCode", async (req) =>
    jsonResponse(
      200,
      await services.performance.ranking(req.ctx, req.params["periodCode"]!, queryId(req.query, "categoryId")),
    ),
  );

  /** Active suppliers with no scorecard for the period — the reporting gap. */
  router.get("/performance/gaps/:periodCode", async (req) =>
    jsonResponse(200, await services.performance.missingScorecards(req.ctx, req.params["periodCode"]!)),
  );
}

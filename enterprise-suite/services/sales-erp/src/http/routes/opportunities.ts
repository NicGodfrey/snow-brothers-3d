import type { SalesModule } from "../../infrastructure/container.js";
import { respond, type Router } from "../router.js";
import { idParam, pageQuery, pageToJSON } from "./helpers.js";

export function registerOpportunityRoutes(router: Router, module: SalesModule): void {
  router.post("/sales/opportunities", ({ ctx, body }) =>
    respond(201, module.opportunities.create(ctx, body).toJSON()),
  );

  /** Static segment registered before /:id so it wins the match. */
  router.get("/sales/opportunities/pipeline", ({ ctx }) =>
    respond(200, module.opportunities.pipelineSummary(ctx)),
  );

  router.get("/sales/opportunities", ({ ctx, query }) => {
    const page = module.opportunities.list(ctx, {
      ...pageQuery(query),
      stage: query.get("stage") ?? undefined,
      accountId: query.get("accountId") ?? undefined,
    });
    return respond(200, pageToJSON(page, (o) => o.toJSON()));
  });

  router.get("/sales/opportunities/:id", ({ ctx, params }) =>
    respond(200, module.opportunities.get(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/opportunities/:id/stage", ({ ctx, params, body }) =>
    respond(200, module.opportunities.moveStage(ctx, idParam(params.id), body).toJSON()),
  );

  router.post("/sales/opportunities/:id/advance", ({ ctx, params }) =>
    respond(200, module.opportunities.advanceStage(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/opportunities/:id/amount", ({ ctx, params, body }) =>
    respond(200, module.opportunities.reviseAmount(ctx, idParam(params.id), body).toJSON()),
  );

  router.post("/sales/opportunities/:id/win", ({ ctx, params }) =>
    respond(200, module.opportunities.win(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/opportunities/:id/lose", ({ ctx, params, body }) =>
    respond(200, module.opportunities.lose(ctx, idParam(params.id), body).toJSON()),
  );
}

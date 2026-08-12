import type { SalesModule } from "../../infrastructure/container.js";
import { respond, type Router } from "../router.js";
import { idParam, pageQuery, pageToJSON } from "./helpers.js";

export function registerQuoteRoutes(router: Router, module: SalesModule): void {
  router.post("/sales/quotes", ({ ctx, body }) =>
    respond(201, module.quotes.view(ctx, module.quotes.create(ctx, body).id)),
  );

  /** Validity sweep for approved quotes past validUntil. */
  router.post("/sales/quotes/expire-sweep", ({ ctx }) =>
    respond(200, { expired: module.quotes.expireOverdueQuotes(ctx) }),
  );

  router.get("/sales/quotes", ({ ctx, query }) => {
    const page = module.quotes.list(ctx, {
      ...pageQuery(query),
      status: query.get("status") ?? undefined,
      accountId: query.get("accountId") ?? undefined,
    });
    return respond(200, pageToJSON(page, (q) => q.toJSON()));
  });

  router.get("/sales/quotes/:id", ({ ctx, params }) =>
    respond(200, module.quotes.view(ctx, idParam(params.id))),
  );

  router.post("/sales/quotes/:id/lines", ({ ctx, params, body }) => {
    module.quotes.addLine(ctx, idParam(params.id), body);
    return respond(200, module.quotes.view(ctx, idParam(params.id)));
  });

  router.patch("/sales/quotes/:id/lines/:lineId", ({ ctx, params, body }) => {
    module.quotes.updateLine(ctx, idParam(params.id), idParam(params.lineId), body);
    return respond(200, module.quotes.view(ctx, idParam(params.id)));
  });

  router.delete("/sales/quotes/:id/lines/:lineId", ({ ctx, params }) => {
    module.quotes.removeLine(ctx, idParam(params.id), idParam(params.lineId));
    return respond(200, module.quotes.view(ctx, idParam(params.id)));
  });

  router.post("/sales/quotes/:id/submit", ({ ctx, params }) =>
    respond(200, module.quotes.submit(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/quotes/:id/approve", ({ ctx, params }) =>
    respond(200, module.quotes.approve(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/quotes/:id/reject", ({ ctx, params, body }) =>
    respond(200, module.quotes.reject(ctx, idParam(params.id), body).toJSON()),
  );

  /** Customer acceptance: emits QuoteAccepted and creates the draft order. */
  router.post("/sales/quotes/:id/accept", ({ ctx, params }) => {
    const { quote, order } = module.quotes.accept(ctx, idParam(params.id));
    return respond(200, { quote: quote.toJSON(), order: order.toJSON() });
  });

  router.post("/sales/quotes/:id/cancel", ({ ctx, params }) =>
    respond(200, module.quotes.cancel(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/quotes/:id/revise", ({ ctx, params, body }) =>
    respond(200, module.quotes.revise(ctx, idParam(params.id), body).toJSON()),
  );
}

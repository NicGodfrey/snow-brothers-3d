import type { SalesModule } from "../../infrastructure/container.js";
import { respond, type Router } from "../router.js";
import { idParam, pageQuery, pageToJSON } from "./helpers.js";

export function registerOrderRoutes(router: Router, module: SalesModule): void {
  router.post("/sales/orders", ({ ctx, body }) =>
    respond(201, module.orders.view(ctx, module.orders.createDraft(ctx, body).id)),
  );

  router.post("/sales/orders/from-quote", ({ ctx, body }) =>
    respond(201, module.orders.view(ctx, module.orders.createFromQuote(ctx, body).id)),
  );

  router.get("/sales/orders", ({ ctx, query }) => {
    const page = module.orders.list(ctx, {
      ...pageQuery(query),
      status: query.get("status") ?? undefined,
      accountId: query.get("accountId") ?? undefined,
    });
    return respond(200, pageToJSON(page, (o) => o.toJSON()));
  });

  router.get("/sales/orders/:id", ({ ctx, params }) =>
    respond(200, module.orders.view(ctx, idParam(params.id))),
  );

  router.post("/sales/orders/:id/lines", ({ ctx, params, body }) => {
    module.orders.addLine(ctx, idParam(params.id), body);
    return respond(200, module.orders.view(ctx, idParam(params.id)));
  });

  router.delete("/sales/orders/:id/lines/:lineId", ({ ctx, params }) => {
    module.orders.removeLine(ctx, idParam(params.id), idParam(params.lineId));
    return respond(200, module.orders.view(ctx, idParam(params.id)));
  });

  router.post("/sales/orders/:id/confirm", ({ ctx, params, body }) =>
    respond(200, module.orders.confirm(ctx, idParam(params.id), body).toJSON()),
  );

  router.post("/sales/orders/:id/allocate", ({ ctx, params, body }) =>
    respond(200, module.orders.allocate(ctx, idParam(params.id), body).toJSON()),
  );

  router.post("/sales/orders/:id/ship", ({ ctx, params, body }) =>
    respond(200, module.orders.ship(ctx, idParam(params.id), body).toJSON()),
  );

  router.post("/sales/orders/:id/invoice", ({ ctx, params }) =>
    respond(200, module.orders.invoice(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/orders/:id/close", ({ ctx, params }) =>
    respond(200, module.orders.close(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/orders/:id/cancel", ({ ctx, params, body }) =>
    respond(200, module.orders.cancel(ctx, idParam(params.id), body).toJSON()),
  );

  router.get("/sales/orders/:id/returns", ({ ctx, params }) =>
    respond(
      200,
      module.returns.listByOrder(ctx, idParam(params.id)).map((r) => r.toJSON()),
    ),
  );
}

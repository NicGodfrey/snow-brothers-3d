import type { SalesModule } from "../../infrastructure/container.js";
import { respond, type Router } from "../router.js";
import { idParam } from "./helpers.js";

export function registerReturnRoutes(router: Router, module: SalesModule): void {
  router.post("/sales/returns", ({ ctx, body }) =>
    respond(201, module.returns.request(ctx, body).toJSON()),
  );

  router.get("/sales/returns/:id", ({ ctx, params }) =>
    respond(200, module.returns.get(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/returns/:id/approve", ({ ctx, params }) =>
    respond(200, module.returns.approve(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/returns/:id/reject", ({ ctx, params, body }) =>
    respond(200, module.returns.reject(ctx, idParam(params.id), body).toJSON()),
  );

  router.post("/sales/returns/:id/receive", ({ ctx, params }) =>
    respond(200, module.returns.markReceived(ctx, idParam(params.id)).toJSON()),
  );

  router.post("/sales/returns/:id/refund", ({ ctx, params }) => {
    const { rma, refund } = module.returns.refund(ctx, idParam(params.id));
    return respond(200, { rma: rma.toJSON(), refund });
  });

  router.post("/sales/returns/:id/cancel", ({ ctx, params }) =>
    respond(200, module.returns.cancel(ctx, idParam(params.id)).toJSON()),
  );
}

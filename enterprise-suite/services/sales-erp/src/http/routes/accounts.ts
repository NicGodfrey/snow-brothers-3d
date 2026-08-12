import { money, moneyToJSON } from "../../kernel/index.js";
import type { SalesModule } from "../../infrastructure/container.js";
import { respond, type Router } from "../router.js";
import { idParam, pageQuery, pageToJSON } from "./helpers.js";

export function registerAccountRoutes(router: Router, module: SalesModule): void {
  router.post("/sales/accounts", ({ ctx, body }) =>
    respond(201, module.accounts.create(ctx, body).snapshot()),
  );

  router.get("/sales/accounts", ({ ctx, query }) => {
    const page = module.accounts.list(ctx, {
      ...pageQuery(query),
      accountType: query.get("accountType") ?? undefined,
      status: query.get("status") ?? undefined,
      q: query.get("q") ?? undefined,
    });
    return respond(200, pageToJSON(page, (a) => a.snapshot()));
  });

  router.get("/sales/accounts/:id", ({ ctx, params }) =>
    respond(200, module.accounts.get(ctx, idParam(params.id)).snapshot()),
  );

  router.patch("/sales/accounts/:id", ({ ctx, params, body }) =>
    respond(200, module.accounts.update(ctx, idParam(params.id), body).snapshot()),
  );

  router.post("/sales/accounts/:id/convert-to-customer", ({ ctx, params }) =>
    respond(200, module.accounts.convertToCustomer(ctx, idParam(params.id)).snapshot()),
  );

  router.post("/sales/accounts/:id/credit-hold", ({ ctx, params, body }) =>
    respond(200, module.accounts.placeCreditHold(ctx, idParam(params.id), body).snapshot()),
  );

  router.delete("/sales/accounts/:id/credit-hold", ({ ctx, params }) =>
    respond(200, module.accounts.releaseCreditHold(ctx, idParam(params.id)).snapshot()),
  );

  router.post("/sales/accounts/:id/credit-limit", ({ ctx, params, body }) =>
    respond(200, module.accounts.changeCreditLimit(ctx, idParam(params.id), body).snapshot()),
  );

  router.post("/sales/accounts/:id/close", ({ ctx, params }) =>
    respond(200, module.accounts.close(ctx, idParam(params.id)).snapshot()),
  );

  /** What-if credit check: ?orderTotalMinor=125000 */
  router.get("/sales/accounts/:id/credit-check", ({ ctx, params, query }) => {
    const accountId = idParam(params.id);
    const account = module.accounts.get(ctx, accountId);
    const orderTotalMinor = Number.parseInt(query.get("orderTotalMinor") ?? "0", 10) || 0;
    const decision = module.credit.check(
      ctx,
      accountId,
      money(orderTotalMinor, account.currencyCode as unknown as string),
    );
    const exposure = module.credit.openExposure(ctx, accountId);
    return respond(200, { ...decision, openExposure: moneyToJSON(exposure) });
  });

  router.post("/sales/accounts/:id/contacts", ({ ctx, params, body }) =>
    respond(201, module.accounts.addContact(ctx, idParam(params.id), body).toJSON()),
  );

  router.get("/sales/accounts/:id/contacts", ({ ctx, params }) =>
    respond(
      200,
      module.accounts.listContacts(ctx, idParam(params.id)).map((c) => c.toJSON()),
    ),
  );

  router.delete("/sales/accounts/:id/contacts/:contactId", ({ ctx, params }) =>
    respond(
      200,
      module.accounts.deactivateContact(ctx, idParam(params.id), idParam(params.contactId)).toJSON(),
    ),
  );
}

import { moneyToJSON } from "../../kernel/index.js";
import type { SalesModule } from "../../infrastructure/container.js";
import { respond, type Router } from "../router.js";
import { idParam } from "./helpers.js";

export function registerPriceListRoutes(router: Router, module: SalesModule): void {
  router.post("/sales/price-lists", ({ ctx, body }) =>
    respond(201, module.pricing.create(ctx, body).snapshot()),
  );

  router.get("/sales/price-lists", ({ ctx }) =>
    respond(
      200,
      module.pricing.list(ctx).map((p) => p.snapshot()),
    ),
  );

  router.get("/sales/price-lists/:id", ({ ctx, params }) =>
    respond(200, module.pricing.get(ctx, idParam(params.id)).snapshot()),
  );

  router.post("/sales/price-lists/:id/items", ({ ctx, params, body }) =>
    respond(200, module.pricing.upsertItem(ctx, idParam(params.id), body).snapshot()),
  );

  router.delete("/sales/price-lists/:id/items/:sku", ({ ctx, params }) =>
    respond(200, module.pricing.removeItem(ctx, idParam(params.id), params.sku).snapshot()),
  );

  router.post("/sales/price-lists/:id/archive", ({ ctx, params }) =>
    respond(200, module.pricing.archive(ctx, idParam(params.id)).snapshot()),
  );

  /** Tier price resolution: ?sku=WIDGET-1&qty=25 */
  router.get("/sales/price-lists/:id/price", ({ ctx, params, query }) => {
    const priceList = module.pricing.get(ctx, idParam(params.id));
    const skuValue = query.get("sku") ?? "";
    const qty = Number.parseInt(query.get("qty") ?? "1", 10) || 1;
    const { unitPrice } = module.pricing.resolvePrice(ctx, {
      priceListId: priceList.id,
      currency: priceList.currencyCode as unknown as string,
      sku: skuValue,
      qty,
    });
    return respond(200, { sku: skuValue.toUpperCase(), qty, unitPrice: moneyToJSON(unitPrice) });
  });
}

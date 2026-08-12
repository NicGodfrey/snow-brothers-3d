import type { SpendWindow } from "../../application/spend-service.js";
import type { ProcurementModule } from "../../module.js";
import { queryCurrency, queryDate } from "../parse.js";
import { jsonOk, type Router } from "../router.js";

function windowOf(query: URLSearchParams): SpendWindow {
  return {
    from: queryDate(query, "from"),
    to: queryDate(query, "to"),
    currency: queryCurrency(query),
  };
}

/**
 * Read-side reporting. Everything is computed from the aggregates on demand;
 * the shapes match what reporting-bi would serve from projections.
 */
export function registerAnalyticsRoutes(router: Router, module: ProcurementModule): void {
  const { analyticsService } = module;

  router.get("/analytics/spend/by-supplier", (req) =>
    jsonOk({ items: analyticsService.spendBySupplier(req.ctx.tenantId, windowOf(req.query)) }),
  );

  router.get("/analytics/spend/by-category", (req) =>
    jsonOk({ items: analyticsService.spendByCategory(req.ctx.tenantId, windowOf(req.query)) }),
  );

  router.get("/analytics/spend/by-cost-center", (req) =>
    jsonOk({ items: analyticsService.spendByCostCenter(req.ctx.tenantId, windowOf(req.query)) }),
  );

  /** Share of spend placed against a contract rather than sourced ad hoc. */
  router.get("/analytics/contract-coverage", (req) =>
    jsonOk(analyticsService.contractCoverageBps(req.ctx.tenantId, windowOf(req.query))),
  );

  router.get("/analytics/supplier-performance", (req) =>
    jsonOk({ items: analyticsService.supplierPerformance(req.ctx.tenantId, windowOf(req.query)) }),
  );

  router.get("/analytics/sourcing-savings", (req) =>
    jsonOk({
      items: analyticsService.sourcingSavings(req.ctx.tenantId, queryCurrency(req.query)),
    }),
  );

  router.get("/analytics/requisition-cycle-time", (req) =>
    jsonOk(analyticsService.requisitionCycleTime(req.ctx.tenantId)),
  );

  router.get("/analytics/open-commitments", (req) =>
    jsonOk({
      items: analyticsService.openCommitments(req.ctx.tenantId, queryCurrency(req.query)),
    }),
  );

  router.get("/analytics/gr-ir", (req) =>
    jsonOk(analyticsService.goodsReceivedNotInvoiced(req.ctx.tenantId, queryCurrency(req.query))),
  );

  router.get("/analytics/dashboard", (req) =>
    jsonOk(analyticsService.dashboard(req.ctx.tenantId, queryCurrency(req.query))),
  );
}

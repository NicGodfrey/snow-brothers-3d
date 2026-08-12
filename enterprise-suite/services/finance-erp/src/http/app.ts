import { normalizePage, paginate } from "@enterprise-suite/shared-kernel";
import { AccountService } from "../application/account-service.js";
import { AllocationService } from "../application/allocation-service.js";
import { ApService } from "../application/ap-service.js";
import { ArService } from "../application/ar-service.js";
import { CostCenterService } from "../application/cost-center-service.js";
import { FxService } from "../application/fx-service.js";
import { JournalService } from "../application/journal-service.js";
import { PeriodCloseService } from "../application/period-close-service.js";
import { PeriodService } from "../application/period-service.js";
import { LedgerSettingsService } from "../application/settings-service.js";
import { TaxService } from "../application/tax-service.js";
import { TrialBalanceService } from "../application/trial-balance-service.js";
import type { AccountId, AllocationRuleId, ApBillId, ApPaymentId, ArInvoiceId, ArPaymentId, CostCenterId, JournalId, TaxCodeId } from "../domain/ids.js";
import type { JournalStatus } from "../domain/journal.js";
import {
  InMemoryAccountRepository,
  InMemoryAllocationRuleRepository,
  InMemoryApBillRepository,
  InMemoryApPaymentRepository,
  InMemoryArInvoiceRepository,
  InMemoryArPaymentRepository,
  InMemoryCostCenterRepository,
  InMemoryFxRateRepository,
  InMemoryJournalRepository,
  InMemoryLedgerSettingsRepository,
  InMemoryPeriodCloseRunRepository,
  InMemoryPeriodRepository,
  InMemoryTaxCodeRepository,
} from "../infrastructure/memory.js";
import { InMemoryOutbox, type EventOutbox } from "../infrastructure/outbox.js";
import { jsonCreated, jsonOk, Router, type HttpRequest } from "./router.js";

export interface FinanceApp {
  readonly router: Router;
  readonly outbox: EventOutbox;
  readonly services: {
    accounts: AccountService;
    journals: JournalService;
    periods: PeriodService;
    periodClose: PeriodCloseService;
    ar: ArService;
    ap: ApService;
    costCenters: CostCenterService;
    allocations: AllocationService;
    tax: TaxService;
    fx: FxService;
    trialBalance: TrialBalanceService;
    settings: LedgerSettingsService;
  };
}

function pageParams(req: HttpRequest) {
  return normalizePage({
    page: req.query.get("page") ? Number(req.query.get("page")) : undefined,
    pageSize: req.query.get("pageSize") ? Number(req.query.get("pageSize")) : undefined,
  });
}

/**
 * Wires repositories, services and HTTP routes together. Everything is
 * in-memory; swapping the repository constructors for Postgres adapters is
 * the only change needed for durable storage.
 */
export function createFinanceApp(): FinanceApp {
  const outbox = new InMemoryOutbox();

  const accountRepo = new InMemoryAccountRepository();
  const journalRepo = new InMemoryJournalRepository();
  const periodRepo = new InMemoryPeriodRepository();
  const closeRunRepo = new InMemoryPeriodCloseRunRepository();
  const arInvoiceRepo = new InMemoryArInvoiceRepository();
  const arPaymentRepo = new InMemoryArPaymentRepository();
  const apBillRepo = new InMemoryApBillRepository();
  const apPaymentRepo = new InMemoryApPaymentRepository();
  const costCenterRepo = new InMemoryCostCenterRepository();
  const allocationRepo = new InMemoryAllocationRuleRepository();
  const taxCodeRepo = new InMemoryTaxCodeRepository();
  const fxRateRepo = new InMemoryFxRateRepository();
  const settingsRepo = new InMemoryLedgerSettingsRepository();

  const accounts = new AccountService(accountRepo, outbox);
  const periods = new PeriodService(periodRepo, outbox);
  const journals = new JournalService(journalRepo, accountRepo, costCenterRepo, periodRepo, outbox);
  const trialBalance = new TrialBalanceService(journalRepo, accountRepo, periodRepo);
  const periodClose = new PeriodCloseService(
    periodRepo,
    closeRunRepo,
    journalRepo,
    arInvoiceRepo,
    apBillRepo,
    trialBalance,
    outbox,
  );
  const settings = new LedgerSettingsService(settingsRepo, accountRepo);
  const ar = new ArService(arInvoiceRepo, arPaymentRepo, accountRepo, taxCodeRepo, settings, journals, outbox);
  const ap = new ApService(apBillRepo, apPaymentRepo, accountRepo, taxCodeRepo, settings, journals, outbox);
  const costCenters = new CostCenterService(costCenterRepo, outbox);
  const allocations = new AllocationService(
    allocationRepo,
    accountRepo,
    costCenterRepo,
    journalRepo,
    periodRepo,
    journals,
    outbox,
  );
  const tax = new TaxService(taxCodeRepo, outbox);
  const fx = new FxService(fxRateRepo, outbox);

  const router = new Router();

  router.get("/health", () => jsonOk({ status: "ok", service: "finance-erp" }));

  // --- Ledger settings ---------------------------------------------------
  router.post("/settings/ledger", async (req) =>
    jsonCreated(await settings.configure(req.ctx, req.body as never)));
  router.get("/settings/ledger", async (req) => jsonOk(await settings.get(req.ctx)));

  // --- Chart of accounts --------------------------------------------------
  router.post("/accounts", async (req) =>
    jsonCreated((await accounts.createAccount(req.ctx, req.body as never)).toJSON()));
  router.get("/accounts", async (req) => {
    const all = await accounts.listAccounts(req.ctx);
    return jsonOk(paginate(all.map((a) => a.toJSON()), pageParams(req)));
  });
  router.get("/accounts/:id", async (req) =>
    jsonOk((await accounts.getAccount(req.ctx, req.params.id as AccountId)).toJSON()));
  router.post("/accounts/:id/deactivate", async (req) =>
    jsonOk((await accounts.deactivateAccount(req.ctx, req.params.id as AccountId)).toJSON()));
  router.post("/accounts/:id/reactivate", async (req) =>
    jsonOk((await accounts.reactivateAccount(req.ctx, req.params.id as AccountId)).toJSON()));

  // --- Journals -----------------------------------------------------------
  router.post("/journals", async (req) =>
    jsonCreated((await journals.createDraft(req.ctx, req.body as never)).toJSON()));
  router.get("/journals", async (req) => {
    const all = await journals.listJournals(req.ctx, {
      status: (req.query.get("status") as JournalStatus | null) ?? undefined,
      periodCode: req.query.get("period") ?? undefined,
      source: req.query.get("source") ?? undefined,
    });
    return jsonOk(paginate(all.map((j) => j.toJSON()), pageParams(req)));
  });
  router.get("/journals/:id", async (req) =>
    jsonOk((await journals.getJournal(req.ctx, req.params.id as JournalId)).toJSON()));
  router.post("/journals/:id/post", async (req) =>
    jsonOk((await journals.post(req.ctx, req.params.id as JournalId)).toJSON()));
  router.post("/journals/:id/reverse", async (req) => {
    const body = (req.body ?? {}) as { reversalDate?: string; memo?: string };
    const { original, reversal } = await journals.reverse(req.ctx, req.params.id as JournalId, body);
    return jsonOk({ original: original.toJSON(), reversal: reversal.toJSON() });
  });

  // --- Posting periods & close workflow ------------------------------------
  router.post("/periods", async (req) =>
    jsonCreated((await periods.openPeriod(req.ctx, req.body as never)).toJSON()));
  router.post("/periods/calendar-year", async (req) => {
    const body = req.body as { fiscalYear: number };
    const opened = await periods.openCalendarYear(req.ctx, body.fiscalYear);
    return jsonCreated(opened.map((p) => p.toJSON()));
  });
  router.get("/periods", async (req) => {
    const year = req.query.get("fiscalYear");
    const all = await periods.listPeriods(req.ctx, year ? Number(year) : undefined);
    return jsonOk(all.map((p) => p.toJSON()));
  });
  router.get("/periods/:code", async (req) =>
    jsonOk((await periods.getPeriod(req.ctx, req.params.code)).toJSON()));
  router.post("/periods/:code/close/begin", async (req) =>
    jsonOk((await periodClose.beginClose(req.ctx, req.params.code)).toJSON()));
  router.post("/periods/:code/close/run-checks", async (req) =>
    jsonOk((await periodClose.runChecks(req.ctx, req.params.code)).toJSON()));
  router.post("/periods/:code/close/complete", async (req) =>
    jsonOk(await periodClose.completeClose(req.ctx, req.params.code)));
  router.post("/periods/:code/close/cancel", async (req) => {
    await periodClose.cancelClose(req.ctx, req.params.code);
    return jsonOk({ periodCode: req.params.code, status: "OPEN" });
  });
  router.post("/periods/:code/reopen", async (req) => {
    const body = (req.body ?? {}) as { reason?: string };
    await periodClose.reopen(req.ctx, req.params.code, body.reason ?? "");
    return jsonOk({ periodCode: req.params.code, status: "OPEN" });
  });
  router.get("/periods/:code/close-status", async (req) =>
    jsonOk(await periodClose.getCloseStatus(req.ctx, req.params.code)));

  // --- Accounts receivable -------------------------------------------------
  router.post("/ar/invoices", async (req) =>
    jsonCreated((await ar.createInvoice(req.ctx, req.body as never)).toJSON()));
  router.get("/ar/invoices", async (req) => {
    const all = await ar.listInvoices(req.ctx, {
      customerId: req.query.get("customerId") ?? undefined,
      status: req.query.get("status") ?? undefined,
    });
    return jsonOk(paginate(all.map((i) => i.toJSON()), pageParams(req)));
  });
  router.get("/ar/invoices/:id", async (req) =>
    jsonOk((await ar.getInvoice(req.ctx, req.params.id as ArInvoiceId)).toJSON()));
  router.post("/ar/invoices/:id/issue", async (req) =>
    jsonOk((await ar.issueInvoice(req.ctx, req.params.id as ArInvoiceId)).toJSON()));
  router.post("/ar/invoices/:id/void", async (req) => {
    const body = (req.body ?? {}) as { reason?: string };
    return jsonOk((await ar.voidInvoice(req.ctx, req.params.id as ArInvoiceId, body.reason ?? "")).toJSON());
  });
  router.post("/ar/payments", async (req) =>
    jsonCreated((await ar.receivePayment(req.ctx, req.body as never)).toJSON()));
  router.get("/ar/payments", async (req) => {
    const all = await ar.listPayments(req.ctx, {
      customerId: req.query.get("customerId") ?? undefined,
    });
    return jsonOk(paginate(all.map((p) => p.toJSON()), pageParams(req)));
  });
  router.post("/ar/payments/:id/apply", async (req) => {
    const body = req.body as { invoiceId: ArInvoiceId; amountMinor: number };
    const result = await ar.applyPayment(req.ctx, req.params.id as ArPaymentId, body.invoiceId, body.amountMinor);
    return jsonOk({ payment: result.payment.toJSON(), invoice: result.invoice.toJSON() });
  });
  router.get("/ar/open-balances", async (req) => jsonOk(await ar.openBalanceByCustomer(req.ctx)));

  // --- Accounts payable ------------------------------------------------------
  router.post("/ap/bills", async (req) =>
    jsonCreated((await ap.createBill(req.ctx, req.body as never)).toJSON()));
  router.get("/ap/bills", async (req) => {
    const all = await ap.listBills(req.ctx, {
      supplierId: req.query.get("supplierId") ?? undefined,
      status: req.query.get("status") ?? undefined,
    });
    return jsonOk(paginate(all.map((b) => b.toJSON()), pageParams(req)));
  });
  router.get("/ap/bills/:id", async (req) =>
    jsonOk((await ap.getBill(req.ctx, req.params.id as ApBillId)).toJSON()));
  router.post("/ap/bills/:id/approve", async (req) =>
    jsonOk((await ap.approveBill(req.ctx, req.params.id as ApBillId)).toJSON()));
  router.post("/ap/bills/:id/void", async (req) => {
    const body = (req.body ?? {}) as { reason?: string };
    return jsonOk((await ap.voidBill(req.ctx, req.params.id as ApBillId, body.reason ?? "")).toJSON());
  });
  router.post("/ap/payments", async (req) =>
    jsonCreated((await ap.issuePayment(req.ctx, req.body as never)).toJSON()));
  router.get("/ap/payments", async (req) => {
    const all = await ap.listPayments(req.ctx, {
      supplierId: req.query.get("supplierId") ?? undefined,
    });
    return jsonOk(paginate(all.map((p) => p.toJSON()), pageParams(req)));
  });
  router.post("/ap/payments/:id/apply", async (req) => {
    const body = req.body as { billId: ApBillId; amountMinor: number };
    const result = await ap.applyPayment(req.ctx, req.params.id as ApPaymentId, body.billId, body.amountMinor);
    return jsonOk({ payment: result.payment.toJSON(), bill: result.bill.toJSON() });
  });
  router.get("/ap/open-balances", async (req) => jsonOk(await ap.openBalanceBySupplier(req.ctx)));

  // --- Cost centers & allocations --------------------------------------------
  router.post("/cost-centers", async (req) =>
    jsonCreated((await costCenters.createCostCenter(req.ctx, req.body as never)).toJSON()));
  router.get("/cost-centers", async (req) =>
    jsonOk((await costCenters.listCostCenters(req.ctx)).map((c) => c.toJSON())));
  router.get("/cost-centers/:id", async (req) =>
    jsonOk((await costCenters.getCostCenter(req.ctx, req.params.id as CostCenterId)).toJSON()));
  router.post("/cost-centers/:id/deactivate", async (req) =>
    jsonOk((await costCenters.deactivateCostCenter(req.ctx, req.params.id as CostCenterId)).toJSON()));

  router.post("/allocations/rules", async (req) =>
    jsonCreated((await allocations.createRule(req.ctx, req.body as never)).toJSON()));
  router.get("/allocations/rules", async (req) =>
    jsonOk((await allocations.listRules(req.ctx)).map((r) => r.toJSON())));
  router.get("/allocations/rules/:id", async (req) =>
    jsonOk((await allocations.getRule(req.ctx, req.params.id as AllocationRuleId)).toJSON()));
  router.post("/allocations/rules/:id/deactivate", async (req) =>
    jsonOk((await allocations.deactivateRule(req.ctx, req.params.id as AllocationRuleId)).toJSON()));
  router.post("/allocations/rules/:id/run", async (req) => {
    const body = req.body as { periodCode: string };
    return jsonOk(await allocations.runRule(req.ctx, req.params.id as AllocationRuleId, body.periodCode));
  });

  // --- Tax codes & FX rates ---------------------------------------------------
  router.post("/tax-codes", async (req) =>
    jsonCreated((await tax.createTaxCode(req.ctx, req.body as never)).toJSON()));
  router.get("/tax-codes", async (req) =>
    jsonOk((await tax.listTaxCodes(req.ctx)).map((t) => t.toJSON())));
  router.get("/tax-codes/:id", async (req) =>
    jsonOk((await tax.getTaxCode(req.ctx, req.params.id as TaxCodeId)).toJSON()));
  router.post("/tax-codes/:id/deactivate", async (req) =>
    jsonOk((await tax.deactivateTaxCode(req.ctx, req.params.id as TaxCodeId)).toJSON()));

  router.post("/fx-rates", async (req) =>
    jsonCreated((await fx.storeRate(req.ctx, req.body as never)).toJSON()));
  router.get("/fx-rates", async (req) => {
    const base = req.query.get("base") ?? undefined;
    const quote = req.query.get("quote") ?? undefined;
    const date = req.query.get("date");
    if (base && quote && date) {
      return jsonOk((await fx.getRate(req.ctx, base, quote, date)).toJSON());
    }
    return jsonOk((await fx.listRates(req.ctx, { base, quote })).map((r) => r.toJSON()));
  });

  // --- Reports -------------------------------------------------------------------
  router.get("/reports/trial-balance", async (req) => {
    const periodCodeValue = req.query.get("period");
    if (!periodCodeValue) {
      return { status: 400, body: { error: "MISSING_PARAM", message: "query param 'period' is required" } };
    }
    const basis = req.query.get("basis") === "CUMULATIVE" ? "CUMULATIVE" : "PERIOD";
    return jsonOk(await trialBalance.compute(req.ctx, { periodCode: periodCodeValue, basis }));
  });

  // --- Outbox inspection (dev/integration aid) --------------------------------------
  router.get("/events", (req) => {
    const eventType = req.query.get("type") ?? undefined;
    return jsonOk(outbox.list(req.ctx.tenantId, eventType));
  });

  // Outbox integration endpoints for the suite outbox-relay (integration-hub).
  // The log is append-only and retained for /events diagnostics; the drain is
  // a cursor over it so each call hands out only what is new.
  let relayCursor = 0;
  router.get("/outbox/pending", () => jsonOk({ items: outbox.list().slice(relayCursor) }));
  router.post("/outbox/drain", () => {
    const items = outbox.list().slice(relayCursor);
    relayCursor += items.length;
    return jsonOk({ count: items.length, items });
  });

  return {
    router,
    outbox,
    services: {
      accounts,
      journals,
      periods,
      periodClose,
      ar,
      ap,
      costCenters,
      allocations,
      tax,
      fx,
      trialBalance,
      settings,
    },
  };
}

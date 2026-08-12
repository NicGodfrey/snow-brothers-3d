import test from "node:test";
import assert from "node:assert/strict";
import { ConflictError, ForbiddenError } from "../src/kernel/index.js";
import { QuoteEventTypes } from "../src/domain/quotes/events.js";
import { seeded } from "./helpers.js";
import { SEED_SKUS } from "../src/fixtures/seed.js";

test("quotes: totals combine tier prices, volume discounts and grouped tax", () => {
  const { module, refs } = seeded();
  const quote = module.quotes.get(refs.ctx, refs.quoteId);

  // Line 1: WIDGET-STD qty 20 -> tier price 2300, default volume discount 2.5%
  const widget = quote.lines[0];
  assert.equal(widget.unitPrice.amountMinor, 2_300);
  assert.equal(widget.discountPercent, 2.5);
  // Line 2: SVC-ONBOARD qty 1 -> 50000, no discount, exempt
  const service = quote.lines[1];
  assert.equal(service.discountPercent, 0);
  assert.equal(service.taxCategory, "exempt");

  const totals = quote.totals();
  assert.equal(totals.subtotal.amountMinor, 96_000); // 20*2300 + 50000
  assert.equal(totals.discountTotal.amountMinor, 1_150); // 2.5% of 46000
  assert.equal(totals.netTotal.amountMinor, 94_850);
  assert.equal(totals.taxTotal.amountMinor, 8_522); // 19% of 44850, half-up
  assert.equal(totals.grandTotal.amountMinor, 103_372);
  const exempt = totals.taxLines.find((t) => t.taxCategory === "exempt");
  assert.equal(exempt?.taxAmount.amountMinor, 0);
});

test("quotes: lines are editable only in draft", () => {
  const { module, refs } = seeded();
  const quote = module.quotes.get(refs.ctx, refs.quoteId);
  const lineId = quote.lines[0].lineId;

  module.quotes.updateLine(refs.ctx, refs.quoteId, lineId, { qty: 30 });
  assert.equal(module.quotes.get(refs.ctx, refs.quoteId).lines[0].qty, 30);

  module.quotes.submit(refs.ctx, refs.quoteId);
  assert.throws(() => module.quotes.updateLine(refs.ctx, refs.quoteId, lineId, { qty: 1 }), ConflictError);
  assert.throws(() => module.quotes.removeLine(refs.ctx, refs.quoteId, lineId), ConflictError);
  assert.throws(
    () => module.quotes.addLine(refs.ctx, refs.quoteId, { sku: SEED_SKUS.book, qty: 1 }),
    ConflictError,
  );
});

test("quotes: empty quotes cannot be submitted", () => {
  const { module, refs } = seeded();
  const empty = module.quotes.create(refs.ctx, {
    accountId: refs.accountId as unknown as string,
    taxRegion: "DE",
    validUntil: "2099-01-01",
  });
  assert.throws(() => module.quotes.submit(refs.ctx, empty.id), ConflictError);
});

test("quotes: discounts above 15% need a sales_manager approver", () => {
  const { module, refs } = seeded();
  const quote = module.quotes.create(refs.ctx, {
    accountId: refs.accountId as unknown as string,
    taxRegion: "DE",
    validUntil: "2099-01-01",
    lines: [{ sku: SEED_SKUS.gadget, qty: 2, discountPercent: 20 }],
  });
  module.quotes.submit(refs.ctx, quote.id);
  assert.throws(() => module.quotes.approve(refs.ctx, quote.id), ForbiddenError);
  module.quotes.approve(refs.managerCtx, quote.id);
  assert.equal(module.quotes.get(refs.ctx, quote.id).status, "approved");
});

test("quotes: reject requires a reason and revise reopens as next revision", () => {
  const { module, refs } = seeded();
  module.quotes.submit(refs.ctx, refs.quoteId);
  module.quotes.reject(refs.ctx, refs.quoteId, { reason: "pricing too high" });
  assert.equal(module.quotes.get(refs.ctx, refs.quoteId).status, "rejected");

  module.quotes.revise(refs.ctx, refs.quoteId, { validUntil: "2099-06-30" });
  const revised = module.quotes.get(refs.ctx, refs.quoteId);
  assert.equal(revised.status, "draft");
  assert.equal(revised.revision, 2);
  assert.equal(revised.lines.length, 2); // lines preserved for editing
  assert.equal(module.outbox.byType(QuoteEventTypes.QuoteRevised).length, 1);
});

test("quotes: acceptance emits QuoteAccepted, wins the opportunity and creates the order", () => {
  const { module, refs } = seeded();
  module.quotes.submit(refs.ctx, refs.quoteId);
  module.quotes.approve(refs.ctx, refs.quoteId); // 2.5% discount needs no manager
  const { quote, order } = module.quotes.accept(refs.ctx, refs.quoteId);

  assert.equal(quote.status, "accepted");
  assert.equal(order.status, "draft");
  assert.equal(order.quoteId, quote.id);
  assert.equal(order.lines.length, 2);
  assert.equal(order.lines[0].unitPrice.amountMinor, 2_300);
  assert.equal(order.orderNumber, "SO-00001");

  const accepted = module.outbox.byType(QuoteEventTypes.QuoteAccepted);
  assert.equal(accepted.length, 1);
  const payload = accepted[0].payload as { grandTotalMinor: number };
  assert.equal(payload.grandTotalMinor, 103_372);

  const opportunity = module.opportunities.get(refs.ctx, refs.opportunityId);
  assert.equal(opportunity.stage, "closed_won");
});

test("quotes: validity is enforced on acceptance and by the expiry sweep", () => {
  const { module, refs, clock } = seeded("2025-06-15T12:00:00Z");
  const quote = module.quotes.create(refs.ctx, {
    accountId: refs.accountId as unknown as string,
    taxRegion: "DE",
    validUntil: "2025-06-20",
    lines: [{ sku: SEED_SKUS.widget, qty: 1 }],
  });
  module.quotes.submit(refs.ctx, quote.id);
  module.quotes.approve(refs.ctx, quote.id);

  clock.advanceDays(10); // now 2025-06-25, past validity
  assert.throws(() => module.quotes.accept(refs.ctx, quote.id), /can no longer be accepted/);

  const expired = module.quotes.expireOverdueQuotes(refs.ctx);
  assert.equal(expired, 1);
  assert.equal(module.quotes.get(refs.ctx, quote.id).status, "expired");
  assert.equal(module.outbox.byType(QuoteEventTypes.QuoteExpired).length, 1);

  module.quotes.revise(refs.ctx, quote.id, { validUntil: "2025-12-31" });
  assert.equal(module.quotes.get(refs.ctx, quote.id).revision, 2);
});

test("quotes: cancelled quotes are terminal", () => {
  const { module, refs } = seeded();
  module.quotes.cancel(refs.ctx, refs.quoteId);
  assert.throws(() => module.quotes.submit(refs.ctx, refs.quoteId), ConflictError);
  assert.throws(() => module.quotes.revise(refs.ctx, refs.quoteId, { validUntil: "2099-01-01" }), ConflictError);
});

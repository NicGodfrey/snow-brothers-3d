import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money, type Ulid } from "@enterprise-suite/shared-kernel";
import type { ChannelQuote } from "../src/domain/channel-quote.js";
import { ChannelEventTypes } from "../src/domain/events.js";
import { DEFAULT_TIER_POLICIES } from "../src/domain/partner.js";
import type { Partner } from "../src/domain/partner.js";
import {
  eventsOfType,
  expectRejects,
  makeApprovedRegistration,
  makePartner,
  makeRegistration,
  usd,
  world,
  type TestWorld,
} from "./helpers.js";

const GOLD = DEFAULT_TIER_POLICIES.gold;

/** 14 appliances plus subscription: 25,200.00 USD at list, asked at 15% off. */
const FIREWALL_LINES = [
  {
    productLine: "network-security",
    sku: "NGFW-4400",
    quantity: 14,
    listUnitPrice: usd(1_200_000),
    requestedUnitPrice: usd(1_020_000),
  },
  {
    productLine: "network-security",
    sku: "NGFW-SUB-3Y",
    quantity: 14,
    listUnitPrice: usd(600_000),
    requestedUnitPrice: usd(510_000),
  },
];

async function protectedQuote(w: TestWorld): Promise<{ partner: Partner; registration: Awaited<ReturnType<typeof makeApprovedRegistration>>; quote: ChannelQuote }> {
  const partner = await makePartner(w, { tier: "gold" });
  const registration = await makeApprovedRegistration(w, partner);
  const quote = await w.container.services.quote.create(w.partnerCtx("dana"), {
    partnerId: partner.id,
    registrationId: registration.id,
    lines: FIREWALL_LINES,
  });
  return { partner, registration, quote };
}

describe("channel quotes and discount authority", () => {
  it("inherits the customer from the registration and totals the lines", async () => {
    const w = world();
    const { quote, registration } = await protectedQuote(w);

    assert.equal(quote.number, "CQ-00001");
    assert.equal(quote.status, "draft");
    assert.equal(quote.customerKey, registration.customerKey);
    assert.equal(quote.customerName, registration.endCustomer.name);
    assert.deepEqual(quote.listTotal(), usd(25_200_000));
    assert.deepEqual(quote.requestedTotal(), usd(21_420_000));
    assert.equal(quote.requestedDiscountBps(), 1_500);
  });

  it("caps an unregistered quote at the tier's base discount", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const quote = await w.container.services.quote.create(w.partnerCtx("dana"), {
      partnerId: partner.id,
      customerKey: "domain:fabrikam.de",
      customerName: "Fabrikam AG",
      lines: [{ productLine: "endpoint", quantity: 10, listUnitPrice: usd(100_000), requestedUnitPrice: usd(90_000) }],
    });

    await expectRejects(
      w.container.services.quote.submit(w.partnerCtx("dana"), quote.id),
      "POLICY_VIOLATION",
      `capped at the tier's base discount of ${GOLD.baseDiscountBps}bps`,
    );

    await w.container.services.quote.updateLine(w.ctx, quote.id, quote.lines[0]!.id, {
      requestedUnitPrice: usd(96_000),
    });
    const result = await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id);
    assert.equal(result.authority.protectedByRegistration, false);
    assert.equal(result.authority.ceilingBps, GOLD.baseDiscountBps);
    assert.equal(result.autoApproved, true, "inside the base band nobody has to decide");
    assert.equal(quote.status, "approved");
  });

  it("unlocks the full band for a protected registration but still asks for a decision above the automatic rate", async () => {
    const w = world();
    const { quote, registration } = await protectedQuote(w);
    const result = await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id, { validityDays: 45 });

    assert.equal(result.authority.protectedByRegistration, true);
    assert.equal(result.authority.ceilingBps, GOLD.maxDiscountBps);
    assert.equal(result.authority.autoApproveBelowBps, registration.discountBps);
    assert.match(result.authority.explanation, /is protected until/);
    assert.equal(result.autoApproved, false);
    assert.equal(quote.status, "submitted");
    assert.equal(quote.requiresApproval, true);
    assert.equal(quote.validUntil, "2026-02-15T00:00:00.000Z");
  });

  it("refuses an ask beyond the ceiling even on a protected deal", async () => {
    const w = world();
    const partner = await makePartner(w, { tier: "gold" });
    const registration = await makeApprovedRegistration(w, partner);
    const quote = await w.container.services.quote.create(w.partnerCtx("dana"), {
      partnerId: partner.id,
      registrationId: registration.id,
      lines: [{ productLine: "network-security", quantity: 1, listUnitPrice: usd(1_000_000), requestedUnitPrice: usd(750_000) }],
    });
    await expectRejects(
      w.container.services.quote.submit(w.partnerCtx("dana"), quote.id),
      "POLICY_VIOLATION",
      "exceeds the 1800bps authority",
    );
  });

  it("approves as a counter-offer, re-pricing every line off list", async () => {
    const w = world();
    const { quote, registration } = await protectedQuote(w);
    await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id);
    await w.container.services.quote.approve(w.ctx, quote.id, {
      discountBps: 1_400,
      notes: "14% against a 15% ask; volume justifies it",
      salesQuoteRef: { system: "sales-erp", id: "quo_001", number: "Q-004512" },
    });

    assert.equal(quote.status, "approved");
    assert.equal(quote.approvedDiscountBps, 1_400);
    assert.deepEqual(quote.approvedTotal(), usd(21_672_000));
    assert.deepEqual(quote.concessionAgainstRequest(), usd(252_000), "the counter-offer claws back 252.00 USD");
    assert.equal(quote.salesQuoteRef?.id, "quo_001");

    // Approving links the quote back onto the registration for the audit trail.
    assert.equal(registration.quotes.length, 1);
    assert.equal(registration.quotes[0]!.number, quote.number);
    assert.equal(eventsOfType(w, ChannelEventTypes.DealRegistrationQuoteLinked).length, 1);
  });

  it("refuses an approval above the authority or one that undercuts the partner's ask", async () => {
    const w = world();
    const { quote } = await protectedQuote(w);
    await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id);

    await expectRejects(
      w.container.services.quote.approve(w.ctx, quote.id, { discountBps: 2_000 }),
      "POLICY_VIOLATION",
      "exceeds the authorized ceiling of 1800bps",
    );

    const undercut = new Map<Ulid, ReturnType<typeof usd>>([[quote.lines[0]!.id, usd(900_000)]]);
    await expectRejects(
      w.container.services.quote.approve(w.ctx, quote.id, { unitPrices: undercut }),
      "VALIDATION",
      "counter-offers only move up",
    );

    // Line-level counter-offers on a mixed basket are fine going the other way.
    const counter = new Map<Ulid, ReturnType<typeof usd>>([[quote.lines[0]!.id, usd(1_100_000)]]);
    await w.container.services.quote.approve(w.ctx, quote.id, { unitPrices: counter });
    assert.deepEqual(quote.approvedTotal(), usd(22_540_000));
  });

  it("validates lines and only lets a draft be edited", async () => {
    const w = world();
    const { quote } = await protectedQuote(w);
    await expectRejects(
      w.container.services.quote.addLine(w.ctx, quote.id, {
        productLine: "endpoint",
        quantity: 1,
        listUnitPrice: usd(100),
        requestedUnitPrice: usd(200),
      }),
      "VALIDATION",
      "cannot exceed the list price",
    );
    await expectRejects(
      w.container.services.quote.addLine(w.ctx, quote.id, {
        productLine: "endpoint",
        quantity: 0,
        listUnitPrice: usd(100),
      }),
      "VALIDATION",
      "greater than zero",
    );
    await expectRejects(
      w.container.services.quote.addLine(w.ctx, quote.id, {
        productLine: "endpoint",
        quantity: 1,
        listUnitPrice: money(100, "EUR"),
      }),
      "VALIDATION",
      "must be in USD",
    );

    await w.container.services.quote.removeLine(w.ctx, quote.id, quote.lines[1]!.id);
    assert.equal(quote.lines.length, 1);
    await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id);
    await expectRejects(
      w.container.services.quote.addLine(w.ctx, quote.id, {
        productLine: "endpoint",
        quantity: 1,
        listUnitPrice: usd(100),
      }),
      "INVALID_STATE",
      "Cannot add lines",
    );
  });

  it("revises into a fresh draft and supersedes the original", async () => {
    const w = world();
    const { quote } = await protectedQuote(w);
    await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id);
    const revision = await w.container.services.quote.revise(w.ctx, quote.id);

    assert.equal(revision.number, "CQ-00002");
    assert.equal(revision.status, "draft");
    assert.equal(revision.lines.length, quote.lines.length);
    assert.deepEqual(revision.requestedTotal(), usd(21_420_000));
    assert.equal(quote.status, "superseded");
    assert.equal(quote.supersededByQuoteId, revision.id);
  });

  it("lapses submitted quotes past their validity, once", async () => {
    const w = world();
    const { quote } = await protectedQuote(w);
    await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id, { validityDays: 30 });

    assert.deepEqual(await w.container.services.quote.sweepExpired(w.ctx), []);
    w.clock.advanceDays(31);
    const expired = await w.container.services.quote.sweepExpired(w.ctx);
    assert.deepEqual(expired.map((q) => q.number), [quote.number]);
    assert.equal(quote.status, "expired");
    assert.deepEqual(await w.container.services.quote.sweepExpired(w.ctx), []);
  });

  it("refuses a quote from a referral agent or against another partner's registration", async () => {
    const w = world();
    const atlas = await makePartner(w, { code: "ATLAS-REF", type: "referral_agent", productLines: ["cloud-platform"] });
    await expectRejects(
      w.container.services.quote.create(w.ctx, {
        partnerId: atlas.id,
        customerKey: "domain:umbrella.example",
        customerName: "Umbrella",
      }),
      "POLICY_VIOLATION",
      "does not transact",
    );

    const northwind = await makePartner(w, { code: "NORTHWIND" });
    const helios = await makePartner(w, { code: "HELIOS" });
    const registration = await makeApprovedRegistration(w, northwind);
    await expectRejects(
      w.container.services.quote.create(w.ctx, { partnerId: helios.id, registrationId: registration.id }),
      "POLICY_VIOLATION",
      "belongs to another partner",
    );
  });
});

describe("channel orders", () => {
  async function bookedDeal(w: TestWorld) {
    const { partner, registration, quote } = await protectedQuote(w);
    await w.container.services.quote.submit(w.partnerCtx("dana"), quote.id);
    await w.container.services.quote.approve(w.ctx, quote.id, { discountBps: 1_400 });
    const order = await w.container.services.order.place(w.partnerCtx("dana"), {
      partnerId: partner.id,
      channelQuoteId: quote.id,
      salesOrderRef: { system: "sales-erp", id: "so_001", number: "SO-009871" },
      poNumber: "PO-77120",
    });
    return { partner, registration, quote, order };
  }

  it("consumes the quote, closes the registration won and records the realised margin", async () => {
    const w = world();
    const { registration, quote, order } = await bookedDeal(w);

    assert.equal(order.number, "CO-00001");
    assert.equal(order.status, "placed");
    assert.deepEqual(order.netValue, usd(21_672_000), "defaults to the approved quote total");
    assert.deepEqual(order.listValue, usd(25_200_000));
    assert.equal(order.partnerMarginBps, 1_400);
    assert.equal(order.sourceType, "partner_sourced");

    assert.equal(quote.status, "ordered");
    assert.equal(quote.orderId, order.id);
    assert.equal(registration.status, "closed_won");
    assert.deepEqual(registration.closure?.value, usd(21_672_000));
    assert.equal(registration.orders.length, 1);
    assert.equal(eventsOfType(w, ChannelEventTypes.DealRegistrationWon).length, 1);
  });

  it("records the same sales order exactly once", async () => {
    const w = world();
    const { partner } = await bookedDeal(w);
    await expectRejects(
      w.container.services.order.place(w.ctx, {
        partnerId: partner.id,
        salesOrderRef: { system: "sales-erp", id: "so_001" },
        netValue: usd(100_000),
        customerKey: "domain:contoso.com",
        customerName: "Contoso",
      }),
      "CONFLICT",
      "already recorded as channel order CO-00001",
    );
  });

  it("needs a value it can book, in the partner's currency", async () => {
    const w = world();
    const partner = await makePartner(w);
    await expectRejects(
      w.container.services.order.place(w.ctx, {
        partnerId: partner.id,
        salesOrderRef: { system: "sales-erp", id: "so_002" },
        customerKey: "domain:contoso.com",
        customerName: "Contoso",
      }),
      "VALIDATION",
      "a net value is required",
    );
    await expectRejects(
      w.container.services.order.place(w.ctx, {
        partnerId: partner.id,
        salesOrderRef: { system: "sales-erp", id: "so_003" },
        netValue: money(100_000, "EUR"),
        customerKey: "domain:contoso.com",
        customerName: "Contoso",
      }),
      "POLICY_VIOLATION",
      "must be in USD",
    );
  });

  it("can book against a registration without closing it", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registration = await makeApprovedRegistration(w, partner);
    const order = await w.container.services.order.place(w.ctx, {
      partnerId: partner.id,
      registrationId: registration.id,
      salesOrderRef: { system: "sales-erp", id: "so_phase_1" },
      netValue: usd(5_000_000),
      closeRegistration: false,
    });
    assert.equal(order.registrationId, registration.id);
    assert.equal(registration.status, "approved", "a phased rollout books without ending the deal");
    assert.equal(registration.orders.length, 1);
  });

  it("walks placed → invoiced → fulfilled and refuses to cancel afterwards", async () => {
    const w = world();
    const { order } = await bookedDeal(w);
    await w.container.services.order.invoice(w.ctx, order.id, { system: "finance-erp", id: "inv_001" });
    assert.equal(order.status, "invoiced");
    await w.container.services.order.fulfill(w.ctx, order.id);
    assert.equal(order.status, "fulfilled");
    await expectRejects(
      w.container.services.order.cancel(w.ctx, order.id, "customer changed their mind"),
      "INVALID_STATE",
      "raise a return instead",
    );
  });

  it("a cancelled order books nothing toward attainment", async () => {
    const w = world();
    const partner = await makePartner(w);
    const registered = await makeApprovedRegistration(w, partner);
    await w.container.services.order.place(w.ctx, {
      partnerId: partner.id,
      registrationId: registered.id,
      salesOrderRef: { system: "sales-erp", id: "so_reg" },
      netValue: usd(8_000_000),
    });
    await w.container.services.order.place(w.ctx, {
      partnerId: partner.id,
      salesOrderRef: { system: "sales-erp", id: "so_unreg" },
      netValue: usd(2_000_000),
      sourceType: "vendor_sourced",
      customerKey: "domain:fabrikam.de",
      customerName: "Fabrikam AG",
    });
    const doomed = await w.container.services.order.place(w.ctx, {
      partnerId: partner.id,
      salesOrderRef: { system: "sales-erp", id: "so_cancelled" },
      netValue: usd(9_000_000),
      customerKey: "domain:initech.io",
      customerName: "Initech",
    });
    await w.container.services.order.cancel(w.ctx, doomed.id, "customer cancelled before shipment");
    assert.deepEqual(doomed.bookedValue(), usd(0));

    const attainment = await w.container.services.order.attainment(w.ctx, partner.id, {
      from: "2026-01-01T00:00:00.000Z" as never,
      to: "2026-12-31T00:00:00.000Z" as never,
    });
    assert.equal(attainment.orderCount, 2);
    assert.deepEqual(attainment.bookedValue, usd(10_000_000));
    assert.deepEqual(attainment.registeredValue, usd(8_000_000));
    assert.deepEqual(attainment.unregisteredValue, usd(2_000_000));
    assert.equal(attainment.registeredShareBps, 8_000);
  });

  it("refuses to place a quote's order for a different partner", async () => {
    const w = world();
    const northwind = await makePartner(w, { code: "NORTHWIND" });
    const helios = await makePartner(w, { code: "HELIOS" });
    const registration = await makeRegistration(w, northwind, { value: usd(1_000_000) });
    await w.container.services.registration.submit(w.ctx, registration.id);
    await expectRejects(
      w.container.services.order.place(w.ctx, {
        partnerId: helios.id,
        registrationId: registration.id,
        salesOrderRef: { system: "sales-erp", id: "so_wrong_partner" },
        netValue: usd(1_000_000),
      }),
      "POLICY_VIOLATION",
      "belongs to another partner",
    );
  });
});

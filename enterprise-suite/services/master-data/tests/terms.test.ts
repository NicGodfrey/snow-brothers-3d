import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HolidayCalendar,
  addMonths,
  endOfMonth,
  isoDate,
  withDayOfMonth,
} from "../src/domain/calendar.js";
import {
  computePaymentSchedule,
  createPaymentTerm,
  describePaymentTerm,
  discountAvailableOn,
  daysOverdue,
  rawDueDate,
} from "../src/domain/payment-terms.js";
import { moneyFromMinor } from "../src/domain/currency.js";
import {
  createShippingTerm,
  estimateDelivery,
  resolveResponsibilities,
  sellerBearsImportDuty,
} from "../src/domain/shipping-terms.js";
import { expectRejects, expectThrows, world } from "./helpers.js";

const CAL = HolidayCalendar.standard();

describe("calendar arithmetic", () => {
  it("adds months by clamping into the target month", () => {
    assert.equal(String(addMonths(isoDate("2026-01-31"), 1)), "2026-02-28");
    assert.equal(String(addMonths(isoDate("2024-01-31"), 1)), "2024-02-29");
    assert.equal(String(addMonths(isoDate("2026-12-15"), 1)), "2027-01-15");
    assert.equal(String(addMonths(isoDate("2026-03-31"), -1)), "2026-02-28");
  });

  it("rejects dates that never existed", () => {
    expectThrows(() => isoDate("2026-02-30"), "VALIDATION", "not a real calendar date");
    expectThrows(() => isoDate("2026-13-01"), "VALIDATION");
    expectThrows(() => isoDate("01/02/2026"), "VALIDATION");
  });

  it("clamps a day-of-month past the end of a short month", () => {
    assert.equal(String(withDayOfMonth(isoDate("2026-02-10"), 31)), "2026-02-28");
    assert.equal(String(endOfMonth(isoDate("2026-11-05"))), "2026-11-30");
  });

  it("rolls onto business days according to the convention", () => {
    // 2026-05-30 is a Saturday, 2026-05-31 a Sunday.
    const saturday = isoDate("2026-05-30");
    assert.equal(String(CAL.adjust(saturday, "none")), "2026-05-30");
    assert.equal(String(CAL.adjust(saturday, "next_business_day")), "2026-06-01");
    assert.equal(String(CAL.adjust(saturday, "previous_business_day")), "2026-05-29");
    // Rolling forward would cross into June, so modified following rolls back.
    assert.equal(String(CAL.adjust(saturday, "modified_following")), "2026-05-29");
    // Mid-month there is nothing to avoid, so it behaves like next business day.
    assert.equal(String(CAL.adjust(isoDate("2026-05-16"), "modified_following")), "2026-05-18");
  });

  it("treats the weekend as data, not as Saturday and Sunday", () => {
    // Friday-Saturday weekend, as used across much of the Gulf.
    const gulf = new HolidayCalendar({ code: "AE", name: "UAE", weekendDays: [5, 6] });
    assert.equal(gulf.isBusinessDay(isoDate("2026-05-31")), true); // Sunday
    assert.equal(gulf.isBusinessDay(isoDate("2026-05-29")), false); // Friday
    assert.equal(String(gulf.adjust(isoDate("2026-05-29"), "next_business_day")), "2026-05-31");
  });

  it("counts business days across holidays", () => {
    const calendar = new HolidayCalendar({
      code: "US",
      name: "US federal",
      holidays: ["2026-07-03"],
    });
    // Thu 2026-07-02 + 1 business day skips the Friday holiday and the weekend.
    assert.equal(String(calendar.addBusinessDays(isoDate("2026-07-02"), 1)), "2026-07-06");
    assert.equal(String(calendar.addBusinessDays(isoDate("2026-07-06"), -1)), "2026-07-02");
    assert.equal(String(calendar.previousBusinessDay(isoDate("2026-07-04"))), "2026-07-02");
  });
});

describe("due rules", () => {
  const jan31 = isoDate("2026-01-31");

  it("computes net days over a month boundary", () => {
    assert.equal(String(rawDueDate({ kind: "net_days", days: 30 }, jan31)), "2026-03-02");
    assert.equal(String(rawDueDate({ kind: "immediate" }, jan31)), "2026-01-31");
  });

  it("starts end-of-month terms when the month closes", () => {
    assert.equal(String(rawDueDate({ kind: "end_of_month", extraDays: 0 }, isoDate("2026-02-03"))), "2026-02-28");
    assert.equal(String(rawDueDate({ kind: "end_of_month", extraDays: 15 }, isoDate("2026-02-03"))), "2026-03-15");
  });

  it("resolves a fixed day of a later month", () => {
    const due = rawDueDate({ kind: "day_of_month", day: 15, monthsAhead: 1 }, isoDate("2026-01-20"));
    assert.equal(String(due), "2026-02-15");
    // Day 31 of a 30-day month clamps rather than overflowing into the next.
    const clamped = rawDueDate({ kind: "day_of_month", day: 31, monthsAhead: 3 }, isoDate("2026-01-20"));
    assert.equal(String(clamped), "2026-04-30");
  });

  it("rolls proximo terms an extra month past the cutoff", () => {
    const rule = { kind: "proximo", cutoffDay: 25, dueDay: 15 } as const;
    assert.equal(String(rawDueDate(rule, isoDate("2026-01-20"))), "2026-02-15");
    assert.equal(String(rawDueDate(rule, isoDate("2026-01-26"))), "2026-03-15");
  });
});

describe("payment term construction", () => {
  it("normalises the code and renders trade notation", () => {
    const term = createPaymentTerm({
      code: " 2-10-net30 ",
      name: "2% 10, net 30",
      due: { kind: "net_days", days: 30 },
      discounts: [{ percent: 2, days: 10 }],
    });
    assert.equal(term.code, "2-10-NET30");
    assert.equal(describePaymentTerm(term), "2/10 net 30");
    assert.equal(
      describePaymentTerm(
        createPaymentTerm({
          code: "EOM15",
          name: "EOM+15",
          due: { kind: "end_of_month", extraDays: 15 },
          graceDays: 3,
        }),
      ),
      "EOM+15 +3d grace",
    );
  });

  it("orders discount windows and rejects ones that outlive the term", () => {
    const term = createPaymentTerm({
      code: "MULTI",
      name: "2/10 1/20 net 30",
      due: { kind: "net_days", days: 30 },
      discounts: [
        { percent: 1, days: 20 },
        { percent: 2, days: 10 },
      ],
    });
    assert.deepEqual(term.discounts.map((d) => d.days), [10, 20]);

    expectThrows(
      () =>
        createPaymentTerm({
          code: "BAD",
          name: "Discount past the due date",
          due: { kind: "net_days", days: 10 },
          discounts: [{ percent: 2, days: 20 }],
        }),
      "VALIDATION",
      "outlives",
    );
  });

  it("refuses discount ladders that reward paying later", () => {
    expectThrows(
      () =>
        createPaymentTerm({
          code: "BACKWARDS",
          name: "1/10 2/20 net 30",
          due: { kind: "net_days", days: 30 },
          discounts: [
            { percent: 1, days: 10 },
            { percent: 2, days: 20 },
          ],
        }),
      "VALIDATION",
      "smaller percentage",
    );
  });

  it("requires instalments to add to the whole invoice", () => {
    expectThrows(
      () =>
        createPaymentTerm({
          code: "SHORT",
          name: "Half now, a quarter later",
          due: { kind: "net_days", days: 30 },
          installments: [
            { sequence: 1, percent: 50, days: 0 },
            { sequence: 2, percent: 25, days: 30 },
          ],
        }),
      "VALIDATION",
      "total 100",
    );
    expectThrows(
      () =>
        createPaymentTerm({
          code: "PREPAY-PLAN",
          name: "Prepay and instalments at once",
          due: { kind: "net_days", days: 30 },
          requiresPrepayment: true,
          installments: [{ sequence: 1, percent: 100, days: 0 }],
        }),
      "VALIDATION",
      "prepayment",
    );
  });

  it("rejects malformed codes and out-of-range rules", () => {
    expectThrows(
      () => createPaymentTerm({ code: "x", name: "Too short", due: { kind: "immediate" } }),
      "VALIDATION",
      "code",
    );
    expectThrows(
      () => createPaymentTerm({ code: "NET400", name: "Net 400", due: { kind: "net_days", days: 400 } }),
      "VALIDATION",
      "365",
    );
    expectThrows(
      () =>
        createPaymentTerm({
          code: "WINDOW",
          name: "Backwards validity",
          due: { kind: "immediate" },
          validFrom: "2026-06-01",
          validTo: "2026-01-01",
        }),
      "VALIDATION",
      "after validFrom",
    );
  });
});

describe("payment schedules", () => {
  it("splits an instalment plan without losing a cent", () => {
    const term = createPaymentTerm({
      code: "MILESTONE-3",
      name: "30/40/30",
      due: { kind: "net_days", days: 30 },
      installments: [
        { sequence: 1, percent: 30, days: 0, label: "On order" },
        { sequence: 2, percent: 40, days: 15, label: "On shipment" },
        { sequence: 3, percent: 30, days: 30, label: "Net 30" },
      ],
    });
    const schedule = computePaymentSchedule(
      term,
      { invoiceDate: "2026-03-02" },
      { amount: moneyFromMinor(100_001, "USD") },
    );
    assert.deepEqual(
      schedule.installments.map((line) => line.amount?.amountMinor),
      // The odd cent lands on the instalment with the largest remainder.
      [30_000, 40_001, 30_000],
    );
    assert.equal(
      schedule.installments.reduce((sum, line) => sum + (line.amount?.amountMinor ?? 0), 0),
      100_001,
    );
    // The invoice is only settled when the last instalment falls due.
    assert.equal(String(schedule.dueDate), "2026-04-01");
    assert.deepEqual(
      schedule.installments.map((line) => String(line.dueDate)),
      ["2026-03-02", "2026-03-17", "2026-04-01"],
    );
  });

  it("prices each discount window off the full invoice", () => {
    const term = createPaymentTerm({
      code: "2-10-NET30",
      name: "2/10 net 30",
      due: { kind: "net_days", days: 30 },
      discounts: [{ percent: 2, days: 10 }],
    });
    const schedule = computePaymentSchedule(
      term,
      { invoiceDate: "2026-01-15" },
      { amount: moneyFromMinor(250_000, "EUR") },
    );
    const [option] = schedule.discounts;
    assert.ok(option);
    assert.equal(option.discountAmount?.amountMinor, 5_000);
    assert.equal(option.payableAmount?.amountMinor, 245_000);
    assert.equal(String(option.lastDay), "2026-01-25");
    assert.equal(schedule.netDays, 30);

    assert.equal(discountAvailableOn(schedule, "2026-01-25")?.percent, 2);
    assert.equal(discountAvailableOn(schedule, "2026-01-26"), undefined);
    assert.equal(daysOverdue(schedule, "2026-02-20"), 6);
    assert.equal(daysOverdue(schedule, "2026-02-01"), 0);
  });

  it("applies grace days before rolling onto a business day", () => {
    const term = createPaymentTerm({
      code: "NET30-G2",
      name: "Net 30 plus two days grace",
      due: { kind: "net_days", days: 30 },
      graceDays: 2,
      businessDayRule: "next_business_day",
    });
    // 2026-01-01 + 30d = 2026-01-31 (Sat), +2 grace = 2026-02-02 (Mon).
    const schedule = computePaymentSchedule(term, { invoiceDate: "2026-01-01" });
    assert.equal(String(schedule.dueDate), "2026-02-02");
    assert.equal(schedule.netDays, 32);
  });

  it("uses the baseline the term names and complains when it is missing", () => {
    const term = createPaymentTerm({
      code: "GR-NET30",
      name: "Net 30 from goods receipt",
      baseline: "goods_receipt_date",
      due: { kind: "net_days", days: 30 },
    });
    const schedule = computePaymentSchedule(term, {
      invoiceDate: "2026-01-05",
      goodsReceiptDate: "2026-01-20",
    });
    assert.equal(String(schedule.baselineDate), "2026-01-20");
    assert.equal(String(schedule.dueDate), "2026-02-19");

    expectThrows(
      () => computePaymentSchedule(term, { invoiceDate: "2026-01-05" }),
      "INVALID_STATE",
      "goods receipt date",
    );
  });
});

describe("payment term service", () => {
  it("keeps codes unique and publishes a creation event", async () => {
    const { container, ctx } = world();
    await container.services.paymentTerm.create(ctx, {
      code: "NET30",
      name: "Net 30",
      due: { kind: "net_days", days: 30 },
    });
    await expectRejects(
      container.services.paymentTerm.create(ctx, {
        code: "net30",
        name: "Net 30 again",
        due: { kind: "net_days", days: 30 },
      }),
      "CONFLICT",
    );
    assert.deepEqual(
      container.outbox.entries(ctx.tenantId).map((event) => event.eventType),
      ["mdm.payment-term.created"],
    );
  });

  it("refuses a term that names a calendar the tenant does not have", async () => {
    const { container, ctx } = world();
    await expectRejects(
      container.services.paymentTerm.create(ctx, {
        code: "NET30-FR",
        name: "Net 30 on the French calendar",
        due: { kind: "net_days", days: 30 },
        calendarCode: "FR",
      }),
      "NOT_FOUND",
    );
  });

  it("schedules against the term's own calendar", async () => {
    const { container, ctx } = world();
    await container.services.calendar.create(ctx, {
      code: "US",
      name: "US federal",
      holidays: ["2026-07-03"],
    });
    await container.services.paymentTerm.create(ctx, {
      code: "NET30-US",
      name: "Net 30, US calendar",
      due: { kind: "net_days", days: 30 },
      calendarCode: "US",
      businessDayRule: "next_business_day",
    });
    // 2026-06-03 + 30d = 2026-07-03, a holiday followed by a weekend.
    const schedule = await container.services.paymentTerm.schedule(ctx, "net30-us", {
      invoiceDate: "2026-06-03",
    });
    assert.equal(String(schedule.dueDate), "2026-07-06");
  });

  it("previews a term before it is saved", async () => {
    const { container, ctx } = world();
    const preview = await container.services.paymentTerm.preview(
      ctx,
      { code: "DRAFT30", name: "Draft", due: { kind: "net_days", days: 30 } },
      { invoiceDate: "2026-01-01", amountMinor: 100_000, currency: "USD" },
    );
    assert.equal(String(preview.dueDate), "2026-01-31");
    assert.equal(preview.amount?.amountMinor, 100_000);
    assert.deepEqual(await container.services.paymentTerm.list(ctx), []);
  });

  it("rejects an amount with no currency", async () => {
    const { container, ctx } = world();
    await expectRejects(
      container.services.paymentTerm.preview(
        ctx,
        { code: "DRAFT30", name: "Draft", due: { kind: "net_days", days: 30 } },
        { invoiceDate: "2026-01-01", amountMinor: 100_000 },
      ),
      "VALIDATION",
      "currency",
    );
  });

  it("retires a term and stops scheduling with it", async () => {
    const { container, ctx } = world();
    await container.services.paymentTerm.create(ctx, {
      code: "NET90",
      name: "Net 90",
      due: { kind: "net_days", days: 90 },
    });
    await expectRejects(container.services.paymentTerm.retire(ctx, "NET90", "  "), "VALIDATION");
    const retired = await container.services.paymentTerm.retire(ctx, "NET90", "Too generous");
    assert.equal(retired.active, false);
    await expectRejects(
      container.services.paymentTerm.schedule(ctx, "NET90", { invoiceDate: "2026-06-01" }),
      "INVALID_STATE",
      "retired",
    );
    await expectRejects(container.services.paymentTerm.retire(ctx, "NET90", "Again"), "INVALID_STATE");
    assert.deepEqual(await container.services.paymentTerm.list(ctx, { activeOnly: true }), []);
  });

  it("reports the discount still available on a payment date", async () => {
    const { container, ctx } = world();
    await container.services.paymentTerm.create(ctx, {
      code: "2-10-NET30",
      name: "2/10 net 30",
      due: { kind: "net_days", days: 30 },
      discounts: [{ percent: 2, days: 10 }],
    });
    const request = { invoiceDate: "2026-01-15", amountMinor: 100_000, currency: "USD" };
    const early = await container.services.paymentTerm.discountOn(ctx, "2-10-NET30", request, "2026-01-20");
    assert.equal(early?.discountAmount?.amountMinor, 2_000);
    assert.equal(
      await container.services.paymentTerm.discountOn(ctx, "2-10-NET30", request, "2026-02-01"),
      undefined,
    );
  });

  it("scopes terms to the tenant that created them", async () => {
    const acme = world("acme");
    const globex = world("globex");
    await acme.container.services.paymentTerm.create(acme.ctx, {
      code: "NET30",
      name: "Net 30",
      due: { kind: "net_days", days: 30 },
    });
    await expectRejects(globex.container.services.paymentTerm.get(globex.ctx, "NET30"), "NOT_FOUND");
  });
});

describe("shipping terms", () => {
  it("blocks maritime rules on land transport", () => {
    expectThrows(
      () =>
        createShippingTerm({
          code: "FOB-TRUCK",
          name: "FOB by road",
          incoterm: "FOB",
          namedPlace: "Rotterdam",
          mode: "road",
        }),
      "VALIDATION",
      "maritime rule",
    );
    const sea = createShippingTerm({
      code: "FOB-RTM",
      name: "FOB Rotterdam",
      incoterm: "fob",
      namedPlace: "Rotterdam",
    });
    assert.equal(sea.mode, "sea");
    assert.equal(sea.freightPaidBy, "buyer");
    assert.equal(sea.freightBilling, "collect");
  });

  it("requires a named place for every rule outside group E", () => {
    expectThrows(
      () => createShippingTerm({ code: "DAP-NOWHERE", name: "DAP", incoterm: "DAP" }),
      "VALIDATION",
      "named",
    );
    const exw = createShippingTerm({ code: "EXW-PLANT", name: "Ex Works", incoterm: "EXW" });
    assert.equal(exw.namedPlace, undefined);
    assert.equal(exw.freightPaidBy, "buyer");
  });

  it("will not let the buyer pay freight the seller owes", () => {
    expectThrows(
      () =>
        createShippingTerm({
          code: "CIF-BUYER",
          name: "CIF billed to the buyer",
          incoterm: "CIF",
          namedPlace: "Hamburg",
          freightPaidBy: "buyer",
        }),
      "VALIDATION",
      "main carriage",
    );
    expectThrows(
      () =>
        createShippingTerm({
          code: "DAP-COLLECT",
          name: "DAP billed collect",
          incoterm: "DAP",
          namedPlace: "Lyon",
          freightBilling: "collect",
        }),
      "VALIDATION",
      "collect",
    );
  });

  it("reads responsibilities from the published rule, not from the term", () => {
    const ddp = createShippingTerm({
      code: "DDP-CUST",
      name: "DDP customer site",
      incoterm: "DDP",
      namedPlace: "Customer dock, Lyon",
      mode: "road",
    });
    const responsibilities = resolveResponsibilities(ddp);
    assert.equal(responsibilities.importClearance, "seller");
    assert.equal(responsibilities.exportClearance, "seller");
    assert.equal(responsibilities.insurance, "not_required");
    assert.equal(responsibilities.clause, "DDP Customer dock, Lyon (Incoterms 2020)");
    assert.equal(sellerBearsImportDuty(ddp), true);

    const cip = createShippingTerm({
      code: "CIP-MAD",
      name: "CIP Madrid",
      incoterm: "CIP",
      namedPlace: "Madrid",
      mode: "road",
    });
    assert.equal(resolveResponsibilities(cip).insurance, "seller");
    assert.equal(sellerBearsImportDuty(cip), false);
  });

  it("projects dispatch and delivery over weekends", () => {
    const term = createShippingTerm({
      code: "DAP-CUST",
      name: "DAP customer site",
      incoterm: "DAP",
      namedPlace: "Customer dock",
      mode: "road",
      handlingDays: 1,
      transitDays: 3,
    });
    // Ordered Thursday 2026-01-01 (a business day here): dispatch Friday,
    // transit lands the following Wednesday.
    const estimate = estimateDelivery(term, "2026-01-01");
    assert.equal(String(estimate.dispatchDate), "2026-01-02");
    assert.equal(String(estimate.estimatedDelivery), "2026-01-07");

    // An order placed on a Saturday cannot dispatch before Monday.
    const weekend = estimateDelivery(term, "2026-01-03");
    assert.equal(String(weekend.dispatchDate), "2026-01-06");
  });
});

describe("shipping term service", () => {
  it("publishes creation events and filters by Incoterm", async () => {
    const { container, ctx } = world();
    await container.services.shippingTerm.create(ctx, {
      code: "DAP-CUST",
      name: "DAP customer site",
      incoterm: "DAP",
      namedPlace: "Customer dock",
      mode: "road",
      transitDays: 3,
    });
    await container.services.shippingTerm.create(ctx, {
      code: "EXW-PLANT",
      name: "Ex Works",
      incoterm: "EXW",
      mode: "road",
    });
    assert.deepEqual(
      container.outbox.entries(ctx.tenantId).map((event) => event.eventType),
      ["mdm.shipping-term.created", "mdm.shipping-term.created"],
    );
    const dap = await container.services.shippingTerm.list(ctx, { incoterm: "dap" });
    assert.deepEqual(dap.map((term) => term.code), ["DAP-CUST"]);
    assert.equal(dap[0]?.responsibilities.mainCarriage, "seller");
    assert.equal(dap[0]?.effective, true);
  });

  it("exposes the Incoterms 2020 table", async () => {
    const { container } = world();
    const rules = container.services.shippingTerm.listIncoterms();
    assert.equal(rules.length, 11);
    assert.equal(container.services.shippingTerm.getIncoterm("exw").group, "E");
    expectThrows(() => container.services.shippingTerm.getIncoterm("XXX"), "VALIDATION");
  });

  it("estimates delivery on a named calendar and refuses retired terms", async () => {
    const { container, ctx } = world();
    await container.services.calendar.create(ctx, {
      code: "PLANT1",
      name: "Plant 1",
      holidays: ["2026-01-02"],
    });
    await container.services.shippingTerm.create(ctx, {
      code: "DAP-CUST",
      name: "DAP customer site",
      incoterm: "DAP",
      namedPlace: "Customer dock",
      mode: "road",
      handlingDays: 1,
      transitDays: 2,
      calendarCode: "PLANT1",
    });
    const estimate = await container.services.shippingTerm.estimateDelivery(ctx, "DAP-CUST", "2026-01-01");
    // The 2nd is a plant holiday, so dispatch slips to Monday the 5th.
    assert.equal(String(estimate.dispatchDate), "2026-01-05");
    assert.equal(String(estimate.estimatedDelivery), "2026-01-07");

    await container.services.shippingTerm.retire(ctx, "DAP-CUST", "Carrier contract ended");
    await expectRejects(
      container.services.shippingTerm.estimateDelivery(ctx, "DAP-CUST", "2026-01-01"),
      "INVALID_STATE",
      "retired",
    );
  });
});

describe("calendar service", () => {
  it("stores weekends and holidays per tenant", async () => {
    const { container, ctx } = world();
    const created = await container.services.calendar.create(ctx, {
      code: " uae ",
      name: "United Arab Emirates",
      weekendDays: [5, 6],
      holidays: ["2026-12-02"],
    });
    assert.equal(created.code, "UAE");
    assert.deepEqual(created.weekendDays, [5, 6]);
    assert.deepEqual(created.holidays.map(String), ["2026-12-02"]);

    await expectRejects(
      container.services.calendar.create(ctx, { code: "UAE", name: "Duplicate" }),
      "CONFLICT",
    );
    await expectRejects(
      container.services.calendar.create(ctx, {
        code: "NEVER",
        name: "Every day off",
        weekendDays: [0, 1, 2, 3, 4, 5, 6],
      }),
      "VALIDATION",
      "working weekday",
    );
    await expectRejects(
      container.services.calendar.create(ctx, { code: "BAD", name: "Bad weekend", weekendDays: [7] }),
      "VALIDATION",
    );
  });

  it("adds holidays and counts working days inclusively", async () => {
    const { container, ctx } = world();
    await container.services.calendar.create(ctx, { code: "US", name: "US federal" });
    await container.services.calendar.addHolidays(ctx, "US", ["2026-07-03", "2026-09-07"]);
    assert.equal(await container.services.calendar.isBusinessDay(ctx, "US", "2026-07-03"), false);
    // Mon 2026-06-29 to Fri 2026-07-10: ten weekdays less the July holiday.
    assert.equal(
      await container.services.calendar.businessDaysBetween(ctx, "US", "2026-06-29", "2026-07-10"),
      9,
    );
    await expectRejects(
      container.services.calendar.businessDaysBetween(ctx, "US", "2026-07-10", "2026-06-29"),
      "VALIDATION",
    );
  });

  it("moves by business days and applies rolling conventions", async () => {
    const { container, ctx } = world();
    await container.services.calendar.create(ctx, { code: "DEFAULT", name: "Mon-Fri" });
    const moved = await container.services.calendar.addBusinessDays(ctx, "DEFAULT", "2026-01-01", 5);
    assert.equal(String(moved.to), "2026-01-08");
    assert.equal(moved.calendarDays, 7);
    assert.equal(
      String(await container.services.calendar.adjust(ctx, "DEFAULT", "2026-05-30", "modified_following")),
      "2026-05-29",
    );
    await expectRejects(
      container.services.calendar.adjust(ctx, "DEFAULT", "2026-05-30", "sideways" as never),
      "VALIDATION",
    );
    await expectRejects(container.services.calendar.get(ctx, "NOPE"), "NOT_FOUND");
  });
});

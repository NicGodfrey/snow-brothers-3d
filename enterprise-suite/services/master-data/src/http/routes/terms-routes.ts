import type { ScheduleRequest } from "../../application/payment-term-service.js";
import { BUSINESS_DAY_RULES, type BusinessDayRule } from "../../domain/calendar.js";
import { ValidationError } from "../../domain/errors.js";
import {
  TERM_BASELINES,
  type CreatePaymentTermInput,
  type DueRule,
  type PaymentDiscount,
  type PaymentInstallment,
  type TermBaseline,
} from "../../domain/payment-terms.js";
import {
  FREIGHT_BILLINGS,
  FREIGHT_PAYERS,
  SHIPMENT_MODES,
  type FreightBilling,
  type FreightPayer,
  type ShipmentMode,
} from "../../domain/shipping-terms.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalBoolean,
  optionalEnum,
  optionalInteger,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredInteger,
  requiredNumber,
  requiredQuery,
  requiredString,
} from "../validate.js";

/** Working calendars, payment terms and shipping terms. */
export function registerTermRoutes(router: Router, container: MasterDataContainer): void {
  const { calendar, paymentTerm, shippingTerm } = container.services;

  // --- calendars -------------------------------------------------------------

  router.get("/calendars", async (req) => jsonResponse(200, await calendar.list(req.ctx)));

  router.post("/calendars", async (req) => {
    const body = asRecord(req.body);
    const weekendDays = body["weekendDays"];
    if (weekendDays !== undefined && !Array.isArray(weekendDays)) {
      throw ValidationError.single("weekendDays", "must be an array of day numbers");
    }
    const created = await calendar.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      weekendDays: weekendDays as number[] | undefined,
      holidays: optionalStringArray(body, "holidays"),
    });
    return jsonResponse(201, created);
  });

  router.get("/calendars/:code", async (req) =>
    jsonResponse(200, await calendar.get(req.ctx, req.params["code"]!)),
  );

  router.post("/calendars/:code/holidays", async (req) => {
    const body = asRecord(req.body);
    const dates = optionalStringArray(body, "dates");
    if (!dates || dates.length === 0) {
      throw ValidationError.single("dates", "must be a non-empty array of ISO dates");
    }
    return jsonResponse(200, await calendar.addHolidays(req.ctx, req.params["code"]!, dates));
  });

  /** Business-day arithmetic on a named calendar. */
  router.get("/calendars/:code/business-days", async (req) => {
    const code = req.params["code"]!;
    const from = requiredQuery(req.query, "from");
    const to = req.query.get("to");
    if (to) {
      return jsonResponse(200, {
        from,
        to,
        businessDays: await calendar.businessDaysBetween(req.ctx, code, from, to),
      });
    }
    const add = req.query.get("add");
    if (add !== null) {
      const count = Number(add);
      if (!Number.isInteger(count)) throw ValidationError.single("add", "must be a whole number");
      return jsonResponse(200, await calendar.addBusinessDays(req.ctx, code, from, count));
    }
    return jsonResponse(200, {
      date: from,
      isBusinessDay: await calendar.isBusinessDay(req.ctx, code, from),
    });
  });

  router.post("/calendars/:code/adjust", async (req) => {
    const body = asRecord(req.body);
    const adjusted = await calendar.adjust(
      req.ctx,
      req.params["code"]!,
      requiredString(body, "date"),
      requiredEnum<BusinessDayRule>(body, "rule", BUSINESS_DAY_RULES),
    );
    return jsonResponse(200, { adjusted });
  });

  // --- payment terms ---------------------------------------------------------

  router.get("/payment-terms", async (req) =>
    jsonResponse(
      200,
      await paymentTerm.list(req.ctx, {
        activeOnly: req.query.get("activeOnly") === "true",
        effectiveOn: req.query.get("effectiveOn") ?? undefined,
      }),
    ),
  );

  router.post("/payment-terms", async (req) =>
    jsonResponse(201, await paymentTerm.create(req.ctx, readPaymentTermInput(asRecord(req.body)))),
  );

  /** Schedules a term that has not been saved, for "what if" screens. */
  router.post("/payment-terms/preview", async (req) => {
    const body = asRecord(req.body);
    const schedule = await paymentTerm.preview(
      req.ctx,
      readPaymentTermInput(asRecord(body["term"])),
      readScheduleRequest(asRecord(body["document"])),
    );
    return jsonResponse(200, schedule);
  });

  router.get("/payment-terms/:code", async (req) =>
    jsonResponse(200, await paymentTerm.get(req.ctx, req.params["code"]!)),
  );

  router.post("/payment-terms/:code/schedule", async (req) => {
    const body = asRecord(req.body);
    const schedule = await paymentTerm.schedule(
      req.ctx,
      req.params["code"]!,
      readScheduleRequest(body),
    );
    const paymentDate = optionalString(body, "paymentDate");
    return jsonResponse(200, {
      ...schedule,
      discountOnPaymentDate: paymentDate
        ? await paymentTerm.discountOn(req.ctx, req.params["code"]!, readScheduleRequest(body), paymentDate)
        : undefined,
    });
  });

  router.post("/payment-terms/:code/retire", async (req) => {
    const body = asRecord(req.body);
    const retired = await paymentTerm.retire(
      req.ctx,
      req.params["code"]!,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, retired);
  });

  // --- shipping terms --------------------------------------------------------

  router.get("/incoterms", () => jsonResponse(200, shippingTerm.listIncoterms()));

  router.get("/incoterms/:code", (req) =>
    jsonResponse(200, shippingTerm.getIncoterm(req.params["code"]!)),
  );

  router.get("/shipping-terms", async (req) =>
    jsonResponse(
      200,
      await shippingTerm.list(req.ctx, {
        activeOnly: req.query.get("activeOnly") === "true",
        incoterm: req.query.get("incoterm") ?? undefined,
        effectiveOn: req.query.get("effectiveOn") ?? undefined,
      }),
    ),
  );

  router.post("/shipping-terms", async (req) => {
    const body = asRecord(req.body);
    const created = await shippingTerm.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      incoterm: requiredString(body, "incoterm"),
      namedPlace: optionalString(body, "namedPlace"),
      mode: optionalEnum<ShipmentMode>(body, "mode", SHIPMENT_MODES),
      freightPaidBy: optionalEnum<FreightPayer>(body, "freightPaidBy", FREIGHT_PAYERS),
      freightBilling: optionalEnum<FreightBilling>(body, "freightBilling", FREIGHT_BILLINGS),
      carrierCode: optionalString(body, "carrierCode"),
      serviceLevel: optionalString(body, "serviceLevel"),
      transitDays: optionalInteger(body, "transitDays"),
      handlingDays: optionalInteger(body, "handlingDays"),
      calendarCode: optionalString(body, "calendarCode"),
      partialShipmentsAllowed: optionalBoolean(body, "partialShipmentsAllowed"),
      validFrom: optionalString(body, "validFrom"),
      validTo: optionalString(body, "validTo"),
    });
    return jsonResponse(201, created);
  });

  router.get("/shipping-terms/:code", async (req) =>
    jsonResponse(200, await shippingTerm.get(req.ctx, req.params["code"]!)),
  );

  /** Who clears, who carries, who insures, and where risk passes. */
  router.get("/shipping-terms/:code/responsibilities", async (req) =>
    jsonResponse(200, await shippingTerm.responsibilities(req.ctx, req.params["code"]!)),
  );

  router.get("/shipping-terms/:code/delivery-estimate", async (req) =>
    jsonResponse(
      200,
      await shippingTerm.estimateDelivery(
        req.ctx,
        req.params["code"]!,
        requiredQuery(req.query, "orderDate"),
        req.query.get("calendar") ?? undefined,
      ),
    ),
  );

  router.post("/shipping-terms/:code/retire", async (req) => {
    const body = asRecord(req.body);
    const retired = await shippingTerm.retire(
      req.ctx,
      req.params["code"]!,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, retired);
  });
}

const DUE_KINDS = ["immediate", "net_days", "end_of_month", "day_of_month", "proximo"] as const;

/**
 * Reads the discriminated due rule. Each variant carries different fields, so
 * the shape is checked here rather than leaving the domain to reject `NaN`.
 */
function readDueRule(body: Record<string, unknown>): DueRule {
  const due = asRecord(body["due"]);
  const kind = requiredEnum<(typeof DUE_KINDS)[number]>(due, "kind", DUE_KINDS);
  switch (kind) {
    case "immediate":
      return { kind };
    case "net_days":
      return { kind, days: requiredInteger(due, "days") };
    case "end_of_month":
      return { kind, extraDays: requiredInteger(due, "extraDays") };
    case "day_of_month":
      return {
        kind,
        day: requiredInteger(due, "day"),
        monthsAhead: requiredInteger(due, "monthsAhead"),
      };
    case "proximo":
      return {
        kind,
        cutoffDay: requiredInteger(due, "cutoffDay"),
        dueDay: requiredInteger(due, "dueDay"),
      };
  }
}

function readDiscounts(body: Record<string, unknown>): readonly PaymentDiscount[] | undefined {
  const raw = body["discounts"];
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw ValidationError.single("discounts", "must be an array");
  return raw.map((entry) => {
    const discount = asRecord(entry);
    return {
      percent: requiredNumber(discount, "percent"),
      days: requiredInteger(discount, "days"),
      description: optionalString(discount, "description"),
    };
  });
}

function readInstallments(body: Record<string, unknown>): readonly PaymentInstallment[] | undefined {
  const raw = body["installments"];
  if (raw === undefined || raw === null) return undefined;
  if (!Array.isArray(raw)) throw ValidationError.single("installments", "must be an array");
  return raw.map((entry) => {
    const installment = asRecord(entry);
    return {
      sequence: requiredInteger(installment, "sequence"),
      percent: requiredNumber(installment, "percent"),
      days: requiredInteger(installment, "days"),
      label: optionalString(installment, "label"),
    };
  });
}

function readPaymentTermInput(body: Record<string, unknown>): CreatePaymentTermInput {
  return {
    code: requiredString(body, "code"),
    name: requiredString(body, "name"),
    description: optionalString(body, "description"),
    baseline: optionalEnum<TermBaseline>(body, "baseline", TERM_BASELINES),
    due: readDueRule(body),
    discounts: readDiscounts(body),
    installments: readInstallments(body),
    graceDays: optionalInteger(body, "graceDays"),
    businessDayRule: optionalEnum<BusinessDayRule>(body, "businessDayRule", BUSINESS_DAY_RULES),
    calendarCode: optionalString(body, "calendarCode"),
    requiresPrepayment: optionalBoolean(body, "requiresPrepayment"),
    validFrom: optionalString(body, "validFrom"),
    validTo: optionalString(body, "validTo"),
  };
}

function readScheduleRequest(body: Record<string, unknown>): ScheduleRequest {
  return {
    invoiceDate: requiredString(body, "invoiceDate"),
    deliveryDate: optionalString(body, "deliveryDate"),
    goodsReceiptDate: optionalString(body, "goodsReceiptDate"),
    statementDate: optionalString(body, "statementDate"),
    amountMinor: optionalInteger(body, "amountMinor"),
    currency: optionalString(body, "currency"),
  };
}

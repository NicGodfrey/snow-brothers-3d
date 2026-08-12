import type { Money } from "@enterprise-suite/shared-kernel";
import {
  addDays,
  compareDates,
  dayOfMonth,
  daysBetween,
  endOfMonth,
  isoDate,
  startOfMonth,
  withDayOfMonth,
  addMonths,
  HolidayCalendar,
  type BusinessDayRule,
  type IsoDate,
} from "./calendar.js";
import { allocate, percentOf, subtractMoney } from "./currency.js";
import { InvalidStateError, ValidationError } from "./errors.js";

/**
 * Payment terms.
 *
 * A term is a rule for turning one document date into a payment schedule. The
 * shapes that actually occur in trade are more varied than "net N":
 *
 * - net days from invoice, delivery or goods receipt,
 * - end-of-month terms ("EOM + 15"), where the clock only starts when the
 *   month closes,
 * - proximo terms ("2nd of the following month, but invoices after the 25th
 *   roll to the month after"),
 * - early-payment discounts, possibly several ("2/10, 1/20, net 30"),
 * - instalments that split one invoice across dates.
 *
 * All of them resolve through `computePaymentSchedule`, which also applies
 * grace days and a business-day rolling convention, and splits the amount
 * across instalments without losing minor units.
 */

export type TermBaseline = "invoice_date" | "delivery_date" | "goods_receipt_date" | "statement_date";

export const TERM_BASELINES: readonly TermBaseline[] = [
  "invoice_date",
  "delivery_date",
  "goods_receipt_date",
  "statement_date",
];

export type DueRule =
  | { readonly kind: "immediate" }
  | { readonly kind: "net_days"; readonly days: number }
  /** Month close plus N days: EOM+0 is the last day of the baseline month. */
  | { readonly kind: "end_of_month"; readonly extraDays: number }
  /** A fixed day, N months out ("the 15th of next month" = day 15, ahead 1). */
  | { readonly kind: "day_of_month"; readonly day: number; readonly monthsAhead: number }
  /**
   * Proximo: invoices dated on or before `cutoffDay` are due on `dueDay` of
   * the next month; later invoices roll one further month.
   */
  | { readonly kind: "proximo"; readonly cutoffDay: number; readonly dueDay: number };

export interface PaymentDiscount {
  readonly percent: number;
  /** Days from the baseline within which payment earns the discount. */
  readonly days: number;
  readonly description?: string;
}

export interface PaymentInstallment {
  readonly sequence: number;
  readonly percent: number;
  readonly days: number;
  readonly label?: string;
}

export interface PaymentTerm {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly baseline: TermBaseline;
  readonly due: DueRule;
  readonly discounts: readonly PaymentDiscount[];
  readonly installments: readonly PaymentInstallment[];
  readonly graceDays: number;
  readonly businessDayRule: BusinessDayRule;
  readonly calendarCode?: string;
  readonly requiresPrepayment: boolean;
  readonly active: boolean;
  readonly validFrom?: IsoDate;
  readonly validTo?: IsoDate;
}

export interface CreatePaymentTermInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly baseline?: TermBaseline;
  readonly due: DueRule;
  readonly discounts?: readonly PaymentDiscount[];
  readonly installments?: readonly PaymentInstallment[];
  readonly graceDays?: number;
  readonly businessDayRule?: BusinessDayRule;
  readonly calendarCode?: string;
  readonly requiresPrepayment?: boolean;
  readonly validFrom?: string;
  readonly validTo?: string;
}

export const PAYMENT_TERM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{1,23}$/;

/** Nominal days a term runs for, used to sanity-check discount windows. */
export function nominalNetDays(due: DueRule): number {
  switch (due.kind) {
    case "immediate":
      return 0;
    case "net_days":
      return due.days;
    case "end_of_month":
      return 30 + due.extraDays;
    case "day_of_month":
      return 30 * Math.max(1, due.monthsAhead);
    case "proximo":
      return 30 + due.dueDay;
    default:
      return 0;
  }
}

function validateDueRule(due: DueRule): void {
  switch (due.kind) {
    case "net_days":
      if (!Number.isInteger(due.days) || due.days < 0 || due.days > 365) {
        throw ValidationError.single("due.days", "net days must be a whole number between 0 and 365");
      }
      return;
    case "end_of_month":
      if (!Number.isInteger(due.extraDays) || due.extraDays < 0 || due.extraDays > 180) {
        throw ValidationError.single("due.extraDays", "must be a whole number between 0 and 180");
      }
      return;
    case "day_of_month":
      if (!Number.isInteger(due.day) || due.day < 1 || due.day > 31) {
        throw ValidationError.single("due.day", "day of month must be between 1 and 31");
      }
      if (!Number.isInteger(due.monthsAhead) || due.monthsAhead < 0 || due.monthsAhead > 12) {
        throw ValidationError.single("due.monthsAhead", "must be between 0 and 12");
      }
      return;
    case "proximo":
      if (!Number.isInteger(due.cutoffDay) || due.cutoffDay < 1 || due.cutoffDay > 31) {
        throw ValidationError.single("due.cutoffDay", "cutoff day must be between 1 and 31");
      }
      if (!Number.isInteger(due.dueDay) || due.dueDay < 1 || due.dueDay > 31) {
        throw ValidationError.single("due.dueDay", "due day must be between 1 and 31");
      }
      return;
    case "immediate":
      return;
    default:
      throw ValidationError.single("due.kind", `unknown due rule "${(due as { kind: string }).kind}"`);
  }
}

export function createPaymentTerm(input: CreatePaymentTermInput): PaymentTerm {
  const code = input.code.trim().toUpperCase();
  if (!PAYMENT_TERM_CODE_PATTERN.test(code)) {
    throw ValidationError.single("code", `invalid payment term code "${input.code}"`);
  }
  if (input.name.trim().length === 0) {
    throw ValidationError.single("name", "name is required");
  }
  const baseline = input.baseline ?? "invoice_date";
  if (!TERM_BASELINES.includes(baseline)) {
    throw ValidationError.single("baseline", `unknown baseline "${baseline}"`);
  }
  validateDueRule(input.due);

  const graceDays = input.graceDays ?? 0;
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) {
    throw ValidationError.single("graceDays", "must be a whole number between 0 and 90");
  }

  const discounts = [...(input.discounts ?? [])].sort((a, b) => a.days - b.days);
  const netDays = nominalNetDays(input.due);
  const seenDays = new Set<number>();
  for (const discount of discounts) {
    if (!(discount.percent > 0) || discount.percent >= 100) {
      throw ValidationError.single("discounts.percent", "discount percent must be between 0 and 100");
    }
    if (!Number.isInteger(discount.days) || discount.days < 0) {
      throw ValidationError.single("discounts.days", "discount days must be a non-negative integer");
    }
    if (discount.days > netDays) {
      throw ValidationError.single(
        "discounts.days",
        `a ${discount.days}-day discount window outlives the ${netDays}-day term`,
      );
    }
    if (seenDays.has(discount.days)) {
      throw ValidationError.single("discounts.days", `two discounts share day ${discount.days}`);
    }
    seenDays.add(discount.days);
  }
  // Later windows must offer less, otherwise nobody would ever pay early.
  for (let index = 1; index < discounts.length; index += 1) {
    if (discounts[index]!.percent >= discounts[index - 1]!.percent) {
      throw ValidationError.single(
        "discounts",
        "a later discount window must offer a smaller percentage than an earlier one",
      );
    }
  }

  const installments = [...(input.installments ?? [])].sort((a, b) => a.sequence - b.sequence);
  if (installments.length > 0) {
    const total = installments.reduce((sum, i) => sum + i.percent, 0);
    if (Math.abs(total - 100) > 1e-6) {
      throw ValidationError.single("installments", `instalment percentages must total 100, got ${total}`);
    }
    const sequences = new Set<number>();
    let previousDays = -1;
    for (const installment of installments) {
      if (!(installment.percent > 0)) {
        throw ValidationError.single("installments.percent", "each instalment must be greater than zero");
      }
      if (sequences.has(installment.sequence)) {
        throw ValidationError.single("installments.sequence", `duplicate sequence ${installment.sequence}`);
      }
      if (!Number.isInteger(installment.days) || installment.days < 0) {
        throw ValidationError.single("installments.days", "days must be a non-negative integer");
      }
      if (installment.days < previousDays) {
        throw ValidationError.single("installments.days", "instalment days must not go backwards");
      }
      sequences.add(installment.sequence);
      previousDays = installment.days;
    }
    if (input.requiresPrepayment) {
      throw ValidationError.single(
        "requiresPrepayment",
        "prepayment terms cannot also carry an instalment plan",
      );
    }
  }

  const validFrom = input.validFrom ? isoDate(input.validFrom) : undefined;
  const validTo = input.validTo ? isoDate(input.validTo) : undefined;
  if (validFrom && validTo && compareDates(validFrom, validTo) >= 0) {
    throw ValidationError.single("validTo", "must be after validFrom");
  }

  return {
    code,
    name: input.name.trim(),
    description: input.description?.trim(),
    baseline,
    due: input.due,
    discounts,
    installments,
    graceDays,
    businessDayRule: input.businessDayRule ?? "none",
    calendarCode: input.calendarCode,
    requiresPrepayment: input.requiresPrepayment ?? false,
    active: true,
    validFrom,
    validTo,
  };
}

export function isTermEffective(term: PaymentTerm, on: IsoDate): boolean {
  if (!term.active) return false;
  if (term.validFrom && compareDates(on, term.validFrom) < 0) return false;
  if (term.validTo && compareDates(on, term.validTo) > 0) return false;
  return true;
}

/** Compact trade notation: "2/10 1/20 net 30". */
export function describePaymentTerm(term: PaymentTerm): string {
  const discountPart = term.discounts
    .map((d) => `${trimNumber(d.percent)}/${d.days}`)
    .join(" ");
  let duePart: string;
  switch (term.due.kind) {
    case "immediate":
      duePart = "due on receipt";
      break;
    case "net_days":
      duePart = `net ${term.due.days}`;
      break;
    case "end_of_month":
      duePart = term.due.extraDays === 0 ? "EOM" : `EOM+${term.due.extraDays}`;
      break;
    case "day_of_month":
      duePart = `day ${term.due.day}${term.due.monthsAhead > 0 ? ` +${term.due.monthsAhead}m` : ""}`;
      break;
    case "proximo":
      duePart = `${ordinal(term.due.dueDay)} proximo (cutoff ${ordinal(term.due.cutoffDay)})`;
      break;
    default:
      duePart = "net 0";
  }
  const grace = term.graceDays > 0 ? ` +${term.graceDays}d grace` : "";
  return [discountPart, duePart].filter(Boolean).join(" ") + grace;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "");
}

function ordinal(day: number): string {
  const suffix = day % 100 >= 11 && day % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
  return `${day}${suffix}`;
}

export interface DocumentDates {
  readonly invoiceDate: string;
  readonly deliveryDate?: string;
  readonly goodsReceiptDate?: string;
  readonly statementDate?: string;
}

export function baselineDateFor(term: PaymentTerm, dates: DocumentDates): IsoDate {
  const pick = (value: string | undefined, label: string): IsoDate => {
    if (!value) {
      throw new InvalidStateError(
        `Term ${term.code} is based on the ${label}, which is missing from the document`,
      );
    }
    return isoDate(value);
  };
  switch (term.baseline) {
    case "delivery_date":
      return pick(dates.deliveryDate, "delivery date");
    case "goods_receipt_date":
      return pick(dates.goodsReceiptDate, "goods receipt date");
    case "statement_date":
      return pick(dates.statementDate, "statement date");
    case "invoice_date":
    default:
      return isoDate(dates.invoiceDate);
  }
}

/** Applies the due rule to a baseline date, before grace and day rolling. */
export function rawDueDate(due: DueRule, baseline: IsoDate): IsoDate {
  switch (due.kind) {
    case "immediate":
      return baseline;
    case "net_days":
      return addDays(baseline, due.days);
    case "end_of_month":
      return addDays(endOfMonth(baseline), due.extraDays);
    case "day_of_month":
      return withDayOfMonth(addMonths(startOfMonth(baseline), due.monthsAhead), due.day);
    case "proximo": {
      const monthsAhead = dayOfMonth(baseline) <= due.cutoffDay ? 1 : 2;
      return withDayOfMonth(addMonths(startOfMonth(baseline), monthsAhead), due.dueDay);
    }
    default:
      return baseline;
  }
}

export interface DiscountOption {
  readonly percent: number;
  readonly lastDay: IsoDate;
  readonly discountAmount?: Money;
  readonly payableAmount?: Money;
  readonly description?: string;
}

export interface InstallmentLine {
  readonly sequence: number;
  readonly percent: number;
  readonly dueDate: IsoDate;
  readonly amount?: Money;
  readonly label?: string;
}

export interface PaymentSchedule {
  readonly termCode: string;
  readonly baselineDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly netDays: number;
  readonly discounts: readonly DiscountOption[];
  readonly installments: readonly InstallmentLine[];
  readonly amount?: Money;
  readonly requiresPrepayment: boolean;
  readonly description: string;
}

export interface ScheduleOptions {
  readonly amount?: Money;
  readonly calendar?: HolidayCalendar;
}

/**
 * Resolves a term against a document into concrete dates and amounts.
 *
 * Instalment amounts come from `allocate`, so the parts always add back up to
 * the invoice total; discount amounts are computed on the full total, since a
 * discount is only earned when the whole balance is settled early.
 */
export function computePaymentSchedule(
  term: PaymentTerm,
  dates: DocumentDates,
  options: ScheduleOptions = {},
): PaymentSchedule {
  const calendar = options.calendar ?? HolidayCalendar.standard();
  const baseline = baselineDateFor(term, dates);
  const due = calendar.adjust(addDays(rawDueDate(term.due, baseline), term.graceDays), term.businessDayRule);

  const discounts: DiscountOption[] = term.discounts.map((discount) => {
    const lastDay = calendar.adjust(addDays(baseline, discount.days), term.businessDayRule);
    if (!options.amount) {
      return { percent: discount.percent, lastDay, description: discount.description };
    }
    const discountAmount = percentOf(options.amount, discount.percent);
    return {
      percent: discount.percent,
      lastDay,
      discountAmount,
      payableAmount: subtractMoney(options.amount, discountAmount),
      description: discount.description,
    };
  });

  let installments: InstallmentLine[] = [];
  if (term.installments.length > 0) {
    const amounts = options.amount
      ? allocate(options.amount, term.installments.map((i) => i.percent))
      : undefined;
    installments = term.installments.map((installment, index) => ({
      sequence: installment.sequence,
      percent: installment.percent,
      dueDate: calendar.adjust(
        addDays(baseline, installment.days + term.graceDays),
        term.businessDayRule,
      ),
      amount: amounts?.[index],
      label: installment.label,
    }));
  }

  return {
    termCode: term.code,
    baselineDate: baseline,
    dueDate: installments.length > 0 ? installments[installments.length - 1]!.dueDate : due,
    netDays: Math.max(0, daysBetween(baseline, due)),
    discounts,
    installments,
    amount: options.amount,
    requiresPrepayment: term.requiresPrepayment,
    description: describePaymentTerm(term),
  };
}

/**
 * The discount still available on a payment date, if any. Returns the largest
 * qualifying percentage — windows are ordered so the earliest is the richest.
 */
export function discountAvailableOn(
  schedule: PaymentSchedule,
  paymentDate: string,
): DiscountOption | undefined {
  const paid = isoDate(paymentDate);
  return schedule.discounts.find((option) => compareDates(paid, option.lastDay) <= 0);
}

/** Days a payment is late; zero when paid on or before the due date. */
export function daysOverdue(schedule: PaymentSchedule, asOf: string): number {
  return Math.max(0, daysBetween(schedule.dueDate, isoDate(asOf)));
}

/** Terms every tenant starts with; extendable per tenant. */
export const STANDARD_PAYMENT_TERMS: readonly CreatePaymentTermInput[] = [
  { code: "IMMEDIATE", name: "Due on receipt", due: { kind: "immediate" } },
  { code: "NET15", name: "Net 15 days", due: { kind: "net_days", days: 15 } },
  { code: "NET30", name: "Net 30 days", due: { kind: "net_days", days: 30 } },
  { code: "NET45", name: "Net 45 days", due: { kind: "net_days", days: 45 } },
  { code: "NET60", name: "Net 60 days", due: { kind: "net_days", days: 60 } },
  {
    code: "2-10-NET30",
    name: "2% 10 days, net 30",
    due: { kind: "net_days", days: 30 },
    discounts: [{ percent: 2, days: 10, description: "Early settlement discount" }],
  },
  {
    code: "1-15-NET45",
    name: "1% 15 days, net 45",
    due: { kind: "net_days", days: 45 },
    discounts: [{ percent: 1, days: 15 }],
  },
  { code: "EOM", name: "End of month", due: { kind: "end_of_month", extraDays: 0 } },
  { code: "EOM15", name: "End of month plus 15 days", due: { kind: "end_of_month", extraDays: 15 } },
  {
    code: "PROX15",
    name: "15th proximo (cutoff 25th)",
    due: { kind: "proximo", cutoffDay: 25, dueDay: 15 },
    businessDayRule: "next_business_day",
  },
  {
    code: "PREPAY",
    name: "Prepayment required",
    due: { kind: "immediate" },
    requiresPrepayment: true,
  },
  {
    code: "MILESTONE-3",
    name: "30% order, 40% shipment, 30% net 30",
    due: { kind: "net_days", days: 30 },
    installments: [
      { sequence: 1, percent: 30, days: 0, label: "On order" },
      { sequence: 2, percent: 40, days: 15, label: "On shipment" },
      { sequence: 3, percent: 30, days: 30, label: "Net 30" },
    ],
  },
];

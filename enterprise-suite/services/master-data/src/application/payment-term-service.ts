import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type Money,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { isoDate, todayUtc, type IsoDate } from "../domain/calendar.js";
import { moneyFromMinor } from "../domain/currency.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { MdmEventTypes } from "../domain/events.js";
import {
  computePaymentSchedule,
  createPaymentTerm,
  describePaymentTerm,
  discountAvailableOn,
  isTermEffective,
  nominalNetDays,
  type CreatePaymentTermInput,
  type DiscountOption,
  type DocumentDates,
  type PaymentSchedule,
  type PaymentTerm,
} from "../domain/payment-terms.js";
import type { CalendarService } from "./calendar-service.js";
import type { Clock, OutboxPort, PaymentTermRepository } from "./ports.js";

export interface ScheduleRequest extends DocumentDates {
  readonly amountMinor?: number;
  readonly currency?: string;
}

export interface PaymentTermView extends PaymentTerm {
  readonly notation: string;
  readonly nominalNetDays: number;
  readonly effective: boolean;
}

/**
 * Payment term catalog and schedule calculation.
 *
 * Terms are referenced by code from customers, orders and invoices, so codes
 * are immutable once created: changing "NET30" to mean 45 days would silently
 * re-date every document that quotes it. A term is retired and superseded
 * instead.
 */
export class PaymentTermService {
  constructor(
    private readonly terms: PaymentTermRepository,
    private readonly calendars: CalendarService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, input: CreatePaymentTermInput): Promise<PaymentTerm> {
    const term = createPaymentTerm(input);
    if (await this.terms.byCode(ctx.tenantId, term.code)) {
      throw new ConflictError(`Payment term ${term.code} already exists`);
    }
    if (term.calendarCode) {
      await this.calendars.resolve(ctx.tenantId, term.calendarCode);
    }
    await this.terms.save(ctx.tenantId, term);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.PaymentTermCreated,
        aggregateType: "PaymentTerm",
        aggregateId: newId("payterm"),
        tenantId: ctx.tenantId,
        payload: {
          code: term.code,
          name: term.name,
          netDays: nominalNetDays(term.due),
          baseline: term.baseline,
          discountPercent: term.discounts[0]?.percent,
          discountDays: term.discounts[0]?.days,
        },
      }),
    ]);
    return term;
  }

  async get(ctx: TenantContext, code: string): Promise<PaymentTerm> {
    const term = await this.terms.byCode(ctx.tenantId, code.trim().toUpperCase());
    if (!term) throw new NotFoundError("PaymentTerm", code);
    return term;
  }

  async list(
    ctx: TenantContext,
    filter: { readonly activeOnly?: boolean; readonly effectiveOn?: string } = {},
  ): Promise<readonly PaymentTermView[]> {
    const on: IsoDate = filter.effectiveOn ? isoDate(filter.effectiveOn) : todayUtc();
    return (await this.terms.all(ctx.tenantId))
      .filter((term) => (filter.activeOnly ? isTermEffective(term, on) : true))
      .map((term) => this.toView(term, on))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async retire(ctx: TenantContext, code: string, reason: string): Promise<PaymentTerm> {
    const term = await this.get(ctx, code);
    if (!term.active) throw new InvalidStateError(`Payment term ${term.code} is already retired`);
    if (reason.trim().length === 0) {
      throw ValidationError.single("reason", "a reason is required to retire a term");
    }
    const retired: PaymentTerm = { ...term, active: false, validTo: todayUtc() };
    await this.terms.save(ctx.tenantId, retired);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.PaymentTermRetired,
        aggregateType: "PaymentTerm",
        aggregateId: newId("payterm"),
        tenantId: ctx.tenantId,
        payload: { code: term.code, reason: reason.trim(), at: this.clock.now() },
      }),
    ]);
    return retired;
  }

  /** Resolves a stored term against a document and returns its schedule. */
  async schedule(ctx: TenantContext, code: string, request: ScheduleRequest): Promise<PaymentSchedule> {
    const term = await this.get(ctx, code);
    const invoiceDate = isoDate(request.invoiceDate);
    if (!isTermEffective(term, invoiceDate)) {
      throw new InvalidStateError(
        `Payment term ${term.code} is not effective on ${invoiceDate}${term.active ? "" : " (retired)"}`,
      );
    }
    return computePaymentSchedule(term, request, {
      amount: this.amountOf(request),
      calendar: await this.calendars.resolve(ctx.tenantId, term.calendarCode),
    });
  }

  /** Computes a schedule for a term that has not been saved yet. */
  async preview(
    ctx: TenantContext,
    input: CreatePaymentTermInput,
    request: ScheduleRequest,
  ): Promise<PaymentSchedule> {
    const term = createPaymentTerm(input);
    return computePaymentSchedule(term, request, {
      amount: this.amountOf(request),
      calendar: await this.calendars.resolve(ctx.tenantId, term.calendarCode),
    });
  }

  /** The discount a payment on `paymentDate` would still earn, if any. */
  async discountOn(
    ctx: TenantContext,
    code: string,
    request: ScheduleRequest,
    paymentDate: string,
  ): Promise<DiscountOption | undefined> {
    const schedule = await this.schedule(ctx, code, request);
    return discountAvailableOn(schedule, paymentDate);
  }

  private amountOf(request: ScheduleRequest): Money | undefined {
    if (request.amountMinor === undefined) return undefined;
    if (!request.currency) {
      throw ValidationError.single("currency", "an amount needs a currency");
    }
    return moneyFromMinor(request.amountMinor, request.currency);
  }

  private toView(term: PaymentTerm, on: IsoDate): PaymentTermView {
    return {
      ...term,
      notation: describePaymentTerm(term),
      nominalNetDays: nominalNetDays(term.due),
      effective: isTermEffective(term, on),
    };
  }
}

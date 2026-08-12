import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { isoDate, todayUtc, type IsoDate } from "../domain/calendar.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { MdmEventTypes } from "../domain/events.js";
import {
  INCOTERMS_2020,
  createShippingTerm,
  estimateDelivery,
  isShippingTermEffective,
  requireIncoterm,
  resolveResponsibilities,
  type CreateShippingTermInput,
  type DeliveryEstimate,
  type IncotermRule,
  type Responsibilities,
  type ShippingTerm,
} from "../domain/shipping-terms.js";
import type { CalendarService } from "./calendar-service.js";
import type { Clock, OutboxPort, ShippingTermRepository } from "./ports.js";

export interface ShippingTermView extends ShippingTerm {
  readonly responsibilities: Responsibilities;
  readonly effective: boolean;
}

/**
 * Shipping term catalog.
 *
 * A term pins an Incoterms rule to a named place, a freight payer and carrier
 * defaults. The rule's allocations (clearance, carriage, insurance, risk) are
 * read from the published table rather than stored per term, so a term can
 * never drift out of line with the Incoterm it claims to use.
 */
export class ShippingTermService {
  constructor(
    private readonly terms: ShippingTermRepository,
    private readonly calendars: CalendarService,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  listIncoterms(): readonly IncotermRule[] {
    return INCOTERMS_2020;
  }

  getIncoterm(code: string): IncotermRule {
    return requireIncoterm(code);
  }

  async create(ctx: TenantContext, input: CreateShippingTermInput): Promise<ShippingTerm> {
    const term = createShippingTerm(input);
    if (await this.terms.byCode(ctx.tenantId, term.code)) {
      throw new ConflictError(`Shipping term ${term.code} already exists`);
    }
    if (term.calendarCode) {
      await this.calendars.resolve(ctx.tenantId, term.calendarCode);
    }
    await this.terms.save(ctx.tenantId, term);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.ShippingTermCreated,
        aggregateType: "ShippingTerm",
        aggregateId: newId("shipterm"),
        tenantId: ctx.tenantId,
        payload: {
          code: term.code,
          incoterm: term.incoterm,
          namedPlace: term.namedPlace,
          freightPaidBy: term.freightPaidBy,
        },
      }),
    ]);
    return term;
  }

  async get(ctx: TenantContext, code: string): Promise<ShippingTerm> {
    const term = await this.terms.byCode(ctx.tenantId, code.trim().toUpperCase());
    if (!term) throw new NotFoundError("ShippingTerm", code);
    return term;
  }

  async list(
    ctx: TenantContext,
    filter: { readonly activeOnly?: boolean; readonly incoterm?: string; readonly effectiveOn?: string } = {},
  ): Promise<readonly ShippingTermView[]> {
    const on: IsoDate = filter.effectiveOn ? isoDate(filter.effectiveOn) : todayUtc();
    const incoterm = filter.incoterm ? requireIncoterm(filter.incoterm).code : undefined;
    return (await this.terms.all(ctx.tenantId))
      .filter((term) => (filter.activeOnly ? isShippingTermEffective(term, on) : true))
      .filter((term) => (incoterm ? term.incoterm === incoterm : true))
      .map((term) => ({
        ...term,
        responsibilities: resolveResponsibilities(term),
        effective: isShippingTermEffective(term, on),
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async responsibilities(ctx: TenantContext, code: string): Promise<Responsibilities> {
    return resolveResponsibilities(await this.get(ctx, code));
  }

  async retire(ctx: TenantContext, code: string, reason: string): Promise<ShippingTerm> {
    const term = await this.get(ctx, code);
    if (!term.active) throw new InvalidStateError(`Shipping term ${term.code} is already retired`);
    if (reason.trim().length === 0) {
      throw ValidationError.single("reason", "a reason is required to retire a term");
    }
    const retired: ShippingTerm = { ...term, active: false, validTo: todayUtc() };
    await this.terms.save(ctx.tenantId, retired);
    await this.outbox.publish([
      envelope({
        eventType: MdmEventTypes.ShippingTermRetired,
        aggregateType: "ShippingTerm",
        aggregateId: newId("shipterm"),
        tenantId: ctx.tenantId,
        payload: { code: term.code, reason: reason.trim(), at: this.clock.now() },
      }),
    ]);
    return retired;
  }

  /** Projects dispatch and delivery dates on the term's shipping calendar. */
  async estimateDelivery(
    ctx: TenantContext,
    code: string,
    orderDate: string,
    calendarCode?: string,
  ): Promise<DeliveryEstimate> {
    const term = await this.get(ctx, code);
    const calendar = await this.calendars.resolve(ctx.tenantId, calendarCode ?? term.calendarCode);
    return estimateDelivery(term, orderDate, calendar);
  }
}

/**
 * Supplier quality use-cases: recording events, SCAR lifecycle, and the
 * per-supplier summary consumed by SRM scorecards.
 */
import {
  NotFoundError,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { SupplierQualityEventRepository } from "../domain/repositories.js";
import {
  SupplierQualityEvent,
  type QmsLinkage,
  type SupplierEventSeverity,
  type SupplierEventStatus,
  type SupplierEventType,
} from "../domain/supplier-quality.js";
import { documentSeries, type Clock, type NumberSeries, type Outbox } from "./ports.js";

export interface RecordSupplierEventCommand {
  supplierId: string;
  supplierName?: string;
  eventType: SupplierEventType;
  severity: SupplierEventSeverity;
  description: string;
  linkage?: QmsLinkage;
  demeritPointsOverride?: number;
  occurredAt?: IsoDateTime;
}

/** Vendor-rating band derived from demerit points over the window. */
export type SupplierQualityBand = "A" | "B" | "C" | "D";

export interface SupplierQualitySummary {
  supplierId: string;
  totalEvents: number;
  openEvents: number;
  totalDemerits: number;
  bySeverity: Record<SupplierEventSeverity, number>;
  byType: Partial<Record<SupplierEventType, number>>;
  openScars: number;
  overdueScars: number;
  band: SupplierQualityBand;
}

function bandForDemerits(demerits: number): SupplierQualityBand {
  if (demerits < 10) return "A";
  if (demerits < 30) return "B";
  if (demerits < 60) return "C";
  return "D";
}

export class SupplierQualityService {
  constructor(
    private readonly events: SupplierQualityEventRepository,
    private readonly outbox: Outbox,
    private readonly numbers: NumberSeries,
    private readonly clock: Clock,
  ) {}

  private async flush(event: SupplierQualityEvent): Promise<void> {
    await this.events.save(event);
    await this.outbox.append(event.pullEvents());
  }

  async recordEvent(ctx: TenantContext, cmd: RecordSupplierEventCommand): Promise<SupplierQualityEvent> {
    const event = SupplierQualityEvent.create(ctx.tenantId, cmd);
    await this.flush(event);
    return event;
  }

  async acknowledge(ctx: TenantContext, eventId: Ulid): Promise<SupplierQualityEvent> {
    const event = await this.getEvent(ctx, eventId);
    event.acknowledge();
    await this.flush(event);
    return event;
  }

  async issueScar(ctx: TenantContext, eventId: Ulid, input: { dueAt: IsoDateTime }): Promise<SupplierQualityEvent> {
    const event = await this.getEvent(ctx, eventId);
    const scarNumber = await this.numbers.next(ctx.tenantId, documentSeries.scar);
    event.issueScar({ scarNumber, issuedBy: ctx.userId, dueAt: input.dueAt });
    await this.flush(event);
    return event;
  }

  async recordScarResponse(
    ctx: TenantContext,
    eventId: Ulid,
    input: { responseSummary: string; accepted: boolean },
  ): Promise<SupplierQualityEvent> {
    const event = await this.getEvent(ctx, eventId);
    event.recordScarResponse({ ...input, reviewedBy: ctx.userId });
    await this.flush(event);
    return event;
  }

  async resolve(ctx: TenantContext, eventId: Ulid, note?: string): Promise<SupplierQualityEvent> {
    const event = await this.getEvent(ctx, eventId);
    event.resolve(ctx.userId, note);
    await this.flush(event);
    return event;
  }

  async writeOff(ctx: TenantContext, eventId: Ulid, reason: string): Promise<SupplierQualityEvent> {
    const event = await this.getEvent(ctx, eventId);
    event.writeOff(ctx.userId, reason);
    await this.flush(event);
    return event;
  }

  async getEvent(ctx: TenantContext, eventId: Ulid): Promise<SupplierQualityEvent> {
    const event = await this.events.findById(ctx.tenantId, eventId);
    if (!event) throw new NotFoundError("SupplierQualityEvent", eventId);
    return event;
  }

  async listEvents(
    ctx: TenantContext,
    filter?: { status?: SupplierEventStatus; supplierId?: string },
  ): Promise<SupplierQualityEvent[]> {
    return this.events.list(ctx.tenantId, filter);
  }

  async supplierSummary(ctx: TenantContext, supplierId: string): Promise<SupplierQualitySummary> {
    const events = await this.events.listBySupplier(ctx.tenantId, supplierId);
    const now = this.clock.now();
    const bySeverity: Record<SupplierEventSeverity, number> = { critical: 0, major: 0, minor: 0 };
    const byType: Partial<Record<SupplierEventType, number>> = {};
    let totalDemerits = 0;
    let openEvents = 0;
    let openScars = 0;
    let overdueScars = 0;

    for (const event of events) {
      totalDemerits += event.demeritPoints;
      bySeverity[event.severity] += 1;
      byType[event.eventType] = (byType[event.eventType] ?? 0) + 1;
      if (event.status !== "resolved" && event.status !== "written-off") openEvents += 1;
      if (event.scar && !event.scar.respondedAt) {
        openScars += 1;
        if (event.isScarOverdue(now)) overdueScars += 1;
      }
    }

    return {
      supplierId,
      totalEvents: events.length,
      openEvents,
      totalDemerits,
      bySeverity,
      byType,
      openScars,
      overdueScars,
      band: bandForDemerits(totalDemerits),
    };
  }
}

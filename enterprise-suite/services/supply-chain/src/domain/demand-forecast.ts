import {
  AggregateRoot,
  DomainError,
  envelope,
  type IsoDateTime,
  nowIso,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { compareDates, startOfIsoWeek, isoDate } from "./calendar.js";
import { SupplyChainEvents, type ForecastPublishedPayload } from "./events.js";
import { assertQty, roundQty, type IsoDate, type LocationCode } from "./types.js";

export type ForecastSource = "STATISTICAL" | "SALES_INPUT" | "OVERRIDE";
export type ForecastStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export interface ForecastEntry {
  /** Monday of the forecast week. */
  readonly weekStart: IsoDate;
  readonly qty: number;
}

interface DemandForecastProps {
  sku: string;
  location: LocationCode;
  source: ForecastSource;
  status: ForecastStatus;
  entries: readonly ForecastEntry[];
  notes: string | null;
  publishedAt: IsoDateTime | null;
}

function normalizeEntries(raw: readonly { weekStart: string; qty: number }[]): ForecastEntry[] {
  const byWeek = new Map<string, number>();
  for (const entry of raw) {
    const week = startOfIsoWeek(isoDate(entry.weekStart));
    const qty = assertQty("forecast qty", entry.qty);
    byWeek.set(week, (byWeek.get(week) ?? 0) + qty);
  }
  return [...byWeek.entries()]
    .map(([weekStart, qty]) => ({ weekStart: weekStart as IsoDate, qty: roundQty(qty) }))
    .sort((a, b) => compareDates(a.weekStart, b.weekStart));
}

/**
 * Weekly demand forecast for one SKU at one location. Only DRAFT forecasts
 * are editable; publishing freezes the series and makes it visible to MRP.
 * The application layer guarantees at most one PUBLISHED forecast per
 * (sku, location) by archiving the previous one on publish.
 */
export class DemandForecast extends AggregateRoot<DemandForecastProps> {
  static create(
    tenantId: TenantId,
    input: {
      sku: string;
      location: LocationCode;
      source?: ForecastSource;
      entries?: readonly { weekStart: string; qty: number }[];
      notes?: string;
    },
  ): DemandForecast {
    const sku = input.sku?.trim().toUpperCase();
    if (!sku) throw new DomainError("Forecast SKU is required", "VALIDATION");
    return new DemandForecast(tenantId, {
      sku,
      location: input.location,
      source: input.source ?? "STATISTICAL",
      status: "DRAFT",
      entries: normalizeEntries(input.entries ?? []),
      notes: input.notes?.trim() || null,
      publishedAt: null,
    });
  }

  get sku(): string {
    return this.props.sku;
  }

  get location(): LocationCode {
    return this.props.location;
  }

  get status(): ForecastStatus {
    return this.props.status;
  }

  get entries(): readonly ForecastEntry[] {
    return this.props.entries;
  }

  get totalQty(): number {
    return roundQty(this.props.entries.reduce((s, e) => s + e.qty, 0));
  }

  /** Merge-upsert entries by week; a qty of 0 removes the week. */
  upsertEntries(raw: readonly { weekStart: string; qty: number }[]): void {
    this.assertDraft();
    const merged = new Map<string, number>(this.props.entries.map((e) => [e.weekStart as string, e.qty]));
    for (const entry of normalizeEntries(raw)) {
      if (entry.qty === 0) merged.delete(entry.weekStart);
      else merged.set(entry.weekStart, entry.qty);
    }
    this.props = {
      ...this.props,
      entries: [...merged.entries()]
        .map(([weekStart, qty]) => ({ weekStart: weekStart as IsoDate, qty }))
        .sort((a, b) => compareDates(a.weekStart, b.weekStart)),
    };
    this.touch();
  }

  publish(): void {
    this.assertDraft();
    if (this.props.entries.length === 0) {
      throw new DomainError("Cannot publish an empty forecast", "VALIDATION", 422);
    }
    this.props = { ...this.props, status: "PUBLISHED", publishedAt: nowIso() };
    const payload: ForecastPublishedPayload = {
      forecastId: this.id,
      sku: this.props.sku,
      location: this.props.location,
      totalQty: this.totalQty,
      horizonStart: this.props.entries[0]?.weekStart ?? null,
      horizonEnd: this.props.entries.at(-1)?.weekStart ?? null,
      entryCount: this.props.entries.length,
    };
    this.raise(
      envelope({
        eventType: SupplyChainEvents.ForecastPublished,
        aggregateType: "DemandForecast",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload,
      }),
    );
  }

  archive(): void {
    if (this.props.status === "ARCHIVED") {
      throw new DomainError("Forecast is already archived", "CONFLICT", 409);
    }
    this.props = { ...this.props, status: "ARCHIVED" };
    this.raise(
      envelope({
        eventType: SupplyChainEvents.ForecastArchived,
        aggregateType: "DemandForecast",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { forecastId: this.id, sku: this.props.sku, location: this.props.location },
      }),
    );
  }

  private assertDraft(): void {
    if (this.props.status !== "DRAFT") {
      throw new DomainError(`Forecast is ${this.props.status}; only DRAFT forecasts are editable`, "CONFLICT", 409);
    }
  }
}

/**
 * Same-bucket forecast consumption: actual (committed) demand consumes the
 * forecast of its own week, so the requirement passed to MRP per week is
 * `max(forecast, actuals)` split as actuals + residual forecast. This
 * prevents double counting demand that has already materialized as orders.
 */
export function residualForecast(
  forecastByBucket: readonly number[],
  actualsByBucket: readonly number[],
): number[] {
  return forecastByBucket.map((forecastQty, i) =>
    roundQty(Math.max(0, forecastQty - (actualsByBucket[i] ?? 0))),
  );
}

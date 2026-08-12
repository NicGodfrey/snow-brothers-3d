import { NotFoundError, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { DemandForecast, type ForecastSource } from "../domain/demand-forecast.js";
import type { LocationCode } from "../domain/types.js";
import type { SupplyChainDeps } from "./ports.js";

export class ForecastService {
  constructor(private readonly deps: SupplyChainDeps) {}

  async createForecast(
    ctx: TenantContext,
    input: {
      sku: string;
      location: LocationCode;
      source?: ForecastSource;
      entries?: readonly { weekStart: string; qty: number }[];
      notes?: string;
    },
  ): Promise<DemandForecast> {
    const forecast = DemandForecast.create(ctx.tenantId, input);
    await this.deps.forecasts.save(forecast);
    return forecast;
  }

  async getForecast(ctx: TenantContext, id: Ulid): Promise<DemandForecast> {
    const forecast = await this.deps.forecasts.findById(ctx.tenantId, id);
    if (!forecast) throw new NotFoundError("DemandForecast", id);
    return forecast;
  }

  async listForecasts(
    ctx: TenantContext,
    filter?: { sku?: string; location?: LocationCode; status?: string },
  ): Promise<DemandForecast[]> {
    return this.deps.forecasts.list(ctx.tenantId, filter);
  }

  async upsertEntries(
    ctx: TenantContext,
    id: Ulid,
    entries: readonly { weekStart: string; qty: number }[],
  ): Promise<DemandForecast> {
    const forecast = await this.getForecast(ctx, id);
    forecast.upsertEntries(entries);
    await this.deps.forecasts.save(forecast);
    return forecast;
  }

  /**
   * Publishing supersedes the currently published forecast for the same
   * (sku, location): the old one is archived in the same operation so MRP
   * only ever sees one active series per item/location.
   */
  async publishForecast(ctx: TenantContext, id: Ulid): Promise<DemandForecast> {
    const forecast = await this.getForecast(ctx, id);
    const current = await this.deps.forecasts.findPublished(ctx.tenantId, forecast.sku, forecast.location);
    if (current && current.id !== forecast.id) {
      current.archive();
      await this.deps.forecasts.save(current);
      await this.deps.outbox.publish(current.pullEvents());
    }
    forecast.publish();
    await this.deps.forecasts.save(forecast);
    await this.deps.outbox.publish(forecast.pullEvents());
    return forecast;
  }

  async archiveForecast(ctx: TenantContext, id: Ulid): Promise<DemandForecast> {
    const forecast = await this.getForecast(ctx, id);
    forecast.archive();
    await this.deps.forecasts.save(forecast);
    await this.deps.outbox.publish(forecast.pullEvents());
    return forecast;
  }
}

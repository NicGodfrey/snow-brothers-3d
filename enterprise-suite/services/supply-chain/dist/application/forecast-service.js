import { NotFoundError } from "@enterprise-suite/shared-kernel";
import { DemandForecast } from "../domain/demand-forecast.js";
export class ForecastService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async createForecast(ctx, input) {
        const forecast = DemandForecast.create(ctx.tenantId, input);
        await this.deps.forecasts.save(forecast);
        return forecast;
    }
    async getForecast(ctx, id) {
        const forecast = await this.deps.forecasts.findById(ctx.tenantId, id);
        if (!forecast)
            throw new NotFoundError("DemandForecast", id);
        return forecast;
    }
    async listForecasts(ctx, filter) {
        return this.deps.forecasts.list(ctx.tenantId, filter);
    }
    async upsertEntries(ctx, id, entries) {
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
    async publishForecast(ctx, id) {
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
    async archiveForecast(ctx, id) {
        const forecast = await this.getForecast(ctx, id);
        forecast.archive();
        await this.deps.forecasts.save(forecast);
        await this.deps.outbox.publish(forecast.pullEvents());
        return forecast;
    }
}
//# sourceMappingURL=forecast-service.js.map
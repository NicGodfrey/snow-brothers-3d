import { DomainError, type Ulid } from "@enterprise-suite/shared-kernel";
import type { ForecastSource } from "../../domain/demand-forecast.js";
import { locationCode } from "../../domain/types.js";
import type { SupplyChainModule } from "../../infrastructure/module.js";
import type { Router } from "../router.js";
import { asObject, optionalArray, optionalString, parseWeekEntries, requireLocation, requireString } from "../validate.js";

const SOURCES: readonly string[] = ["STATISTICAL", "SALES_INPUT", "OVERRIDE"];

export function registerForecastRoutes(router: Router, module: SupplyChainModule): void {
  router.post("/forecasts", async (req) => {
    const body = asObject(req.body);
    const source = optionalString(body, "source");
    if (source !== undefined && !SOURCES.includes(source)) {
      throw new DomainError(`source must be one of ${SOURCES.join(", ")}`, "VALIDATION");
    }
    const entriesRaw = optionalArray(body, "entries");
    const forecast = await module.forecasts.createForecast(req.ctx, {
      sku: requireString(body, "sku"),
      location: requireLocation(body),
      source: source as ForecastSource | undefined,
      entries: entriesRaw ? parseWeekEntries(entriesRaw) : undefined,
      notes: optionalString(body, "notes"),
    });
    return { status: 201, body: forecast.toJSON() };
  });

  router.get("/forecasts", async (req) => {
    const forecasts = await module.forecasts.listForecasts(req.ctx, {
      sku: req.query.sku?.toUpperCase(),
      location: req.query.location ? locationCode(req.query.location) : undefined,
      status: req.query.status,
    });
    return { status: 200, body: { forecasts: forecasts.map((f) => f.toJSON()) } };
  });

  router.get("/forecasts/:id", async (req) => {
    const forecast = await module.forecasts.getForecast(req.ctx, req.params.id as Ulid);
    return { status: 200, body: forecast.toJSON() };
  });

  router.put("/forecasts/:id/entries", async (req) => {
    const body = asObject(req.body);
    const entries = parseWeekEntries(requireArrayOf(body, "entries"));
    const forecast = await module.forecasts.upsertEntries(req.ctx, req.params.id as Ulid, entries);
    return { status: 200, body: forecast.toJSON() };
  });

  router.post("/forecasts/:id/publish", async (req) => {
    const forecast = await module.forecasts.publishForecast(req.ctx, req.params.id as Ulid);
    return { status: 200, body: forecast.toJSON() };
  });

  router.post("/forecasts/:id/archive", async (req) => {
    const forecast = await module.forecasts.archiveForecast(req.ctx, req.params.id as Ulid);
    return { status: 200, body: forecast.toJSON() };
  });
}

function requireArrayOf(body: Record<string, unknown>, key: string): unknown[] {
  const value = body[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw new DomainError(`${key} must be a non-empty array`, "VALIDATION");
  }
  return value;
}

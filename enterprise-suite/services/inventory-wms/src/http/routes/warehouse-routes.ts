import { normalizePage, paginate } from "@enterprise-suite/shared-kernel";
import type { WarehouseService } from "../../application/warehouse-service.js";
import {
  optInt,
  optString,
  reqBody,
  reqEnum,
  reqId,
  reqString,
} from "../../application/validation.js";
import { BIN_TYPES, ZONE_TYPES } from "../../domain/warehouse.js";
import { requireWriteRole } from "../context.js";
import { created, okJson, type Route } from "../router.js";

export function warehouseRoutes(service: WarehouseService): Route[] {
  return [
    {
      method: "POST",
      pattern: "/warehouses",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const warehouse = await service.createWarehouse(req.ctx, {
          code: reqString(body.code, "code", { maxLength: 32 }),
          name: reqString(body.name, "name", { maxLength: 120 }),
          addressLine1: optString(body.addressLine1, "addressLine1"),
          city: optString(body.city, "city", { maxLength: 80 }),
          country: optString(body.country, "country", { maxLength: 2 }),
          timezone: optString(body.timezone, "timezone", { maxLength: 64 }),
        });
        return created(warehouse.toJSON());
      },
    },
    {
      method: "GET",
      pattern: "/warehouses",
      handler: async (req) => {
        const warehouses = await service.listWarehouses(req.ctx);
        const page = normalizePage({
          page: numberParam(req.query.get("page")),
          pageSize: numberParam(req.query.get("pageSize")),
        });
        return okJson(paginate(warehouses.map((w) => w.toJSON()), page));
      },
    },
    {
      method: "GET",
      pattern: "/warehouses/:id",
      handler: async (req) => {
        const warehouse = await service.getWarehouse(req.ctx, reqId(req.params.id, "id"));
        return okJson(warehouse.toJSON());
      },
    },
    {
      method: "GET",
      pattern: "/warehouses/:id/topology",
      handler: async (req) => {
        const topology = await service.getTopology(req.ctx, reqId(req.params.id, "id"));
        return okJson({
          warehouse: topology.warehouse.toJSON(),
          zones: topology.zones.map(({ zone, bins }) => ({
            zone: zone.toJSON(),
            bins: bins.map((b) => b.toJSON()),
          })),
        });
      },
    },
    {
      method: "POST",
      pattern: "/warehouses/:id/rename",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const warehouse = await service.renameWarehouse(
          req.ctx,
          reqId(req.params.id, "id"),
          reqString(body.name, "name", { maxLength: 120 }),
        );
        return okJson(warehouse.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/warehouses/:id/activate",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const warehouse = await service.setWarehouseStatus(
          req.ctx,
          reqId(req.params.id, "id"),
          "activate",
        );
        return okJson(warehouse.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/warehouses/:id/deactivate",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const warehouse = await service.setWarehouseStatus(
          req.ctx,
          reqId(req.params.id, "id"),
          "deactivate",
        );
        return okJson(warehouse.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/warehouses/:id/zones",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const zone = await service.addZone(req.ctx, {
          warehouseId: reqId(req.params.id, "id"),
          code: reqString(body.code, "code", { maxLength: 32 }),
          name: reqString(body.name, "name", { maxLength: 120 }),
          zoneType: reqEnum(body.zoneType, "zoneType", ZONE_TYPES),
        });
        return created(zone.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/warehouses/:id/bins",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const bin = await service.addBin(req.ctx, {
          warehouseId: reqId(req.params.id, "id"),
          zoneId: reqId(body.zoneId, "zoneId"),
          code: reqString(body.code, "code", { maxLength: 32 }),
          binType: reqEnum(body.binType, "binType", BIN_TYPES),
          maxUnits: optInt(body.maxUnits, "maxUnits", { min: 0 }),
          pickSequence: optInt(body.pickSequence, "pickSequence", { min: 0 }),
        });
        return created(bin.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/bins/:binId/block",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const body = reqBody(req.body);
        const bin = await service.blockBin(
          req.ctx,
          reqId(req.params.binId, "binId"),
          reqString(body.reason, "reason", { maxLength: 200 }),
        );
        return okJson(bin.toJSON());
      },
    },
    {
      method: "POST",
      pattern: "/bins/:binId/unblock",
      handler: async (req) => {
        requireWriteRole(req.ctx);
        const bin = await service.unblockBin(req.ctx, reqId(req.params.binId, "binId"));
        return okJson(bin.toJSON());
      },
    },
  ];
}

export function numberParam(value: string | null): number | undefined {
  if (value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

import { UOM_DIMENSIONS, type UomDimension } from "../../domain/uom.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  numberQuery,
  optionalInteger,
  optionalString,
  requiredEnum,
  requiredNumber,
  requiredQuery,
  requiredString,
} from "../validate.js";

/** Units of measure, item conversions and quantity arithmetic. */
export function registerUomRoutes(router: Router, container: MasterDataContainer): void {
  const { uom } = container.services;

  router.get("/uoms", async (req) =>
    jsonResponse(
      200,
      await uom.listUnits(req.ctx, {
        dimension: (req.query.get("dimension") as UomDimension | null) ?? undefined,
      }),
    ),
  );

  router.get("/uoms/dimensions", () => jsonResponse(200, UOM_DIMENSIONS));

  /** Every unit a value in `from` can reach, for populating a UoM picker. */
  router.get("/uoms/convertible", async (req) =>
    jsonResponse(
      200,
      await uom.convertibleUnits(
        req.ctx,
        requiredQuery(req.query, "from"),
        req.query.get("product") ?? undefined,
      ),
    ),
  );

  /** Rounds an order quantity onto a packaging multiple. */
  router.get("/uoms/round", (req) =>
    jsonResponse(200, {
      value: uom.roundToMultiple(
        numberQuery(req.query, "value"),
        numberQuery(req.query, "increment"),
        (req.query.get("mode") as "up" | "down" | "nearest" | null) ?? "up",
      ),
    }),
  );

  router.post("/uoms", async (req) => {
    const body = asRecord(req.body);
    const unit = await uom.createUnit(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      symbol: optionalString(body, "symbol"),
      dimension: requiredEnum<UomDimension>(body, "dimension", UOM_DIMENSIONS),
      toBase: requiredNumber(body, "toBase"),
      precision: optionalInteger(body, "precision"),
    });
    return jsonResponse(201, unit);
  });

  router.get("/uoms/:code", async (req) =>
    jsonResponse(200, await uom.getUnit(req.ctx, req.params["code"]!)),
  );

  router.get("/uom-conversions", async (req) =>
    jsonResponse(200, await uom.listConversions(req.ctx, req.query.get("product") ?? undefined)),
  );

  router.post("/uom-conversions", async (req) => {
    const body = asRecord(req.body);
    const conversion = await uom.defineConversion(req.ctx, {
      from: requiredString(body, "from"),
      to: requiredString(body, "to"),
      factor: requiredNumber(body, "factor"),
      productCode: optionalString(body, "productCode"),
      note: optionalString(body, "note"),
    });
    return jsonResponse(201, conversion);
  });

  router.delete("/uom-conversions/:from/:to", async (req) => {
    await uom.removeConversion(req.ctx, {
      from: req.params["from"]!,
      to: req.params["to"]!,
      productCode: req.query.get("product") ?? undefined,
    });
    return jsonResponse(204);
  });

  /** Returns the resolved value plus the steps taken to get there. */
  router.post("/uoms/convert", async (req) => {
    const body = asRecord(req.body);
    const result = await uom.convert(req.ctx, {
      value: requiredNumber(body, "value"),
      from: requiredString(body, "from"),
      to: requiredString(body, "to"),
      productCode: optionalString(body, "productCode"),
    });
    return jsonResponse(200, result);
  });
}

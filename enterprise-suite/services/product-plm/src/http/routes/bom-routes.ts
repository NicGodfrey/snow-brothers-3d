import type { IsoDateTime, Ulid } from "@enterprise-suite/shared-kernel";
import { ValidationError } from "../../domain/errors.js";
import type { PlmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredNumber,
  requiredString,
} from "../validate.js";

function isoParam(value: string | null, field: string): IsoDateTime | undefined {
  if (value === null) return undefined;
  if (Number.isNaN(Date.parse(value))) {
    throw ValidationError.single(field, "must be an ISO date-time");
  }
  return value as IsoDateTime;
}

export function registerBomRoutes(router: Router, container: PlmContainer): void {
  const { services } = container;

  router.post("/products/:id/bom", async (req) => {
    const bom = await services.bom.createBom(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(201, bom.toJSON());
  });

  router.get("/products/:id/bom", async (req) =>
    jsonResponse(200, (await services.bom.getByProduct(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/products/:id/bom/revisions", async (req) => {
    const body = asRecord(req.body ?? {});
    const revision = await services.bom.createDraftRevision(req.ctx, req.params["id"] as Ulid, {
      basedOnRevisionId: optionalString(body, "basedOnRevisionId") as Ulid | undefined,
      notes: optionalString(body, "notes"),
    });
    return jsonResponse(201, revision);
  });

  router.post("/products/:id/bom/revisions/:revisionId/lines", async (req) => {
    const body = asRecord(req.body);
    const line = await services.bom.addLine(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["revisionId"] as Ulid,
      {
        componentProductId: requiredString(body, "componentProductId") as Ulid,
        componentVariantId: optionalString(body, "componentVariantId") as Ulid | undefined,
        quantity: requiredNumber(body, "quantity"),
        uom: requiredString(body, "uom"),
        scrapFactor: optionalNumber(body, "scrapFactor"),
        referenceDesignators: optionalStringArray(body, "referenceDesignators"),
        notes: optionalString(body, "notes"),
      },
    );
    return jsonResponse(201, line);
  });

  router.patch("/products/:id/bom/revisions/:revisionId/lines/:lineId", async (req) => {
    const body = asRecord(req.body);
    const line = await services.bom.updateLine(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["revisionId"] as Ulid,
      req.params["lineId"] as Ulid,
      {
        quantity: optionalNumber(body, "quantity"),
        uom: optionalString(body, "uom"),
        scrapFactor: optionalNumber(body, "scrapFactor"),
        referenceDesignators: optionalStringArray(body, "referenceDesignators"),
        notes: optionalString(body, "notes"),
      },
    );
    return jsonResponse(200, line);
  });

  router.delete("/products/:id/bom/revisions/:revisionId/lines/:lineId", async (req) => {
    await services.bom.removeLine(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["revisionId"] as Ulid,
      req.params["lineId"] as Ulid,
    );
    return jsonResponse(204);
  });

  router.post("/products/:id/bom/revisions/:revisionId/release", async (req) => {
    const body = asRecord(req.body);
    const effectiveFrom = requiredString(body, "effectiveFrom");
    if (Number.isNaN(Date.parse(effectiveFrom))) {
      throw ValidationError.single("effectiveFrom", "must be an ISO date-time");
    }
    const effectiveTo = optionalString(body, "effectiveTo");
    if (effectiveTo !== undefined && Number.isNaN(Date.parse(effectiveTo))) {
      throw ValidationError.single("effectiveTo", "must be an ISO date-time");
    }
    const revision = await services.bom.releaseRevision(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["revisionId"] as Ulid,
      {
        effectiveFrom: effectiveFrom as IsoDateTime,
        effectiveTo: effectiveTo as IsoDateTime | undefined,
        ecoId: optionalString(body, "ecoId") as Ulid | undefined,
      },
    );
    return jsonResponse(200, revision);
  });

  router.post("/products/:id/bom/revisions/:revisionId/obsolete", async (req) => {
    const revision = await services.bom.obsoleteRevision(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["revisionId"] as Ulid,
    );
    return jsonResponse(200, revision);
  });

  router.get("/products/:id/bom/effective", async (req) => {
    const revision = await services.bom.effectiveRevision(
      req.ctx,
      req.params["id"] as Ulid,
      isoParam(req.query.get("at"), "at"),
    );
    return jsonResponse(200, revision);
  });

  router.get("/products/:id/bom/explosion", async (req) => {
    const quantityRaw = req.query.get("quantity");
    const quantity = quantityRaw !== null ? Number(quantityRaw) : undefined;
    if (quantity !== undefined && !(quantity > 0)) {
      throw ValidationError.single("quantity", "must be a positive number");
    }
    const result = await services.bom.explode(req.ctx, req.params["id"] as Ulid, {
      at: isoParam(req.query.get("at"), "at"),
      quantity,
      flattenPhantoms: req.query.get("flattenPhantoms") !== "false",
    });
    return jsonResponse(200, result);
  });

  router.get("/products/:id/bom/requirements", async (req) => {
    const quantityRaw = req.query.get("quantity");
    const quantity = quantityRaw !== null ? Number(quantityRaw) : undefined;
    if (quantity !== undefined && !(quantity > 0)) {
      throw ValidationError.single("quantity", "must be a positive number");
    }
    const lines = await services.bom.requirements(req.ctx, req.params["id"] as Ulid, {
      at: isoParam(req.query.get("at"), "at"),
      quantity,
    });
    return jsonResponse(200, lines);
  });

  router.get("/products/:id/cost-rollup", async (req) => {
    const result = await services.costing.rollUp(req.ctx, {
      productId: req.params["id"] as Ulid,
      variantId: (req.query.get("variantId") as Ulid | null) ?? undefined,
      at: isoParam(req.query.get("at"), "at"),
      currency: req.query.get("currency") ?? undefined,
    });
    return jsonResponse(200, result);
  });

  router.post("/products/:id/cost-rollup/apply", async (req) => {
    const body = asRecord(req.body ?? {});
    const result = await services.costing.applyRollup(req.ctx, {
      productId: req.params["id"] as Ulid,
      variantId: optionalString(body, "variantId") as Ulid | undefined,
      at: optionalString(body, "at") as IsoDateTime | undefined,
      currency: optionalString(body, "currency"),
    });
    return jsonResponse(200, result);
  });
}

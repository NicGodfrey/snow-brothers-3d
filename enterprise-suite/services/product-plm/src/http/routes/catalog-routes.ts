import type { Ulid } from "@enterprise-suite/shared-kernel";
import { UOM_DIMENSIONS, type UomDimension } from "../../domain/uom.js";
import { ATTRIBUTE_TYPES, type AttributeOption, type AttributeType } from "../../domain/attribute.js";
import { ValidationError } from "../../domain/errors.js";
import type { PlmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalNumber,
  optionalString,
  requiredEnum,
  requiredNumber,
  requiredString,
} from "../validate.js";

/** Units of measure, categories, attribute definitions and sets. */
export function registerCatalogRoutes(router: Router, container: PlmContainer): void {
  const { services } = container;

  // --- units of measure ------------------------------------------------------
  router.get("/uoms", async (req) => jsonResponse(200, await services.uom.listUnits(req.ctx)));

  router.post("/uoms", async (req) => {
    const body = asRecord(req.body);
    const unit = await services.uom.createUnit(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      dimension: requiredEnum<UomDimension>(body, "dimension", UOM_DIMENSIONS),
      toBase: requiredNumber(body, "toBase"),
      precision: optionalNumber(body, "precision"),
    });
    return jsonResponse(201, unit);
  });

  router.get("/uoms/convert", async (req) => {
    const value = Number(req.query.get("value"));
    const from = req.query.get("from");
    const to = req.query.get("to");
    if (!Number.isFinite(value) || !from || !to) {
      throw new ValidationError("Query params required: value (number), from, to");
    }
    return jsonResponse(200, await services.uom.convert(req.ctx, { value, from, to }));
  });

  // --- categories --------------------------------------------------------------
  router.get("/categories", async (req) => jsonResponse(200, await services.category.tree(req.ctx)));

  router.post("/categories", async (req) => {
    const body = asRecord(req.body);
    const record = await services.category.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      parentId: optionalString(body, "parentId") as Ulid | undefined,
      sortOrder: optionalNumber(body, "sortOrder"),
    });
    return jsonResponse(201, record);
  });

  router.post("/categories/:id/move", async (req) => {
    const body = asRecord(req.body ?? {});
    const record = await services.category.move(
      req.ctx,
      req.params["id"] as Ulid,
      optionalString(body, "parentId") as Ulid | undefined,
    );
    return jsonResponse(200, record);
  });

  router.patch("/categories/:id", async (req) => {
    const body = asRecord(req.body);
    const record = await services.category.rename(req.ctx, req.params["id"] as Ulid, requiredString(body, "name"));
    return jsonResponse(200, record);
  });

  // --- attribute definitions & sets ---------------------------------------------
  router.get("/attribute-definitions", async (req) =>
    jsonResponse(200, await services.attribute.listDefinitions(req.ctx)),
  );

  router.post("/attribute-definitions", async (req) => {
    const body = asRecord(req.body);
    let options: AttributeOption[] | undefined;
    if (body["options"] !== undefined) {
      if (!Array.isArray(body["options"])) {
        throw ValidationError.single("options", "must be an array of { code, label }");
      }
      options = (body["options"] as unknown[]).map((entry, index) => {
        const option = asRecord(entry);
        const code = option["code"];
        const label = option["label"];
        if (typeof code !== "string" || typeof label !== "string") {
          throw ValidationError.single(`options[${index}]`, "must have string code and label");
        }
        return { code, label };
      });
    }
    const record = await services.attribute.createDefinition(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      type: requiredEnum<AttributeType>(body, "type", ATTRIBUTE_TYPES),
      options,
      min: optionalNumber(body, "min"),
      max: optionalNumber(body, "max"),
      pattern: optionalString(body, "pattern"),
      uom: optionalString(body, "uom"),
      description: optionalString(body, "description"),
    });
    return jsonResponse(201, record);
  });

  router.get("/attribute-sets", async (req) => jsonResponse(200, await services.attribute.listSets(req.ctx)));

  router.get("/attribute-sets/:id", async (req) =>
    jsonResponse(200, await services.attribute.getSet(req.ctx, req.params["id"] as Ulid)),
  );

  router.post("/attribute-sets", async (req) => {
    const body = asRecord(req.body);
    if (!Array.isArray(body["members"])) {
      throw ValidationError.single("members", "must be an array");
    }
    const members = (body["members"] as unknown[]).map((entry, index) => {
      const member = asRecord(entry);
      const code = member["code"];
      if (typeof code !== "string") {
        throw ValidationError.single(`members[${index}].code`, "must be a string");
      }
      return {
        code,
        required: member["required"] === true,
        isVariantAxis: member["isVariantAxis"] === true,
      };
    });
    const record = await services.attribute.createSet(req.ctx, {
      name: requiredString(body, "name"),
      members,
    });
    return jsonResponse(201, record);
  });
}

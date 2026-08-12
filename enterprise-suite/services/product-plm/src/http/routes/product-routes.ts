import type { Ulid } from "@enterprise-suite/shared-kernel";
import { ValidationError } from "../../domain/errors.js";
import { LIFECYCLE_STATES, type LifecycleState } from "../../domain/lifecycle.js";
import { PRODUCT_TYPES, type ProductType } from "../../domain/product.js";
import type { PlmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalAttributeMap,
  optionalString,
  pageFromQuery,
  requiredEnum,
  requiredNumber,
  requiredString,
  requiredStringMap,
} from "../validate.js";

export function registerProductRoutes(router: Router, container: PlmContainer): void {
  const { services } = container;

  router.post("/products", async (req) => {
    const body = asRecord(req.body);
    const product = await services.product.create(req.ctx, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      description: optionalString(body, "description"),
      type: requiredEnum<ProductType>(body, "type", PRODUCT_TYPES),
      baseUom: requiredString(body, "baseUom"),
      sku: optionalString(body, "sku"),
      categoryId: optionalString(body, "categoryId") as Ulid | undefined,
      attributeSetId: optionalString(body, "attributeSetId") as Ulid | undefined,
    });
    return jsonResponse(201, product.toJSON());
  });

  router.get("/products", async (req) => {
    const lifecycle = req.query.get("lifecycle");
    if (lifecycle !== null && !(LIFECYCLE_STATES as readonly string[]).includes(lifecycle)) {
      throw ValidationError.single("lifecycle", `must be one of [${LIFECYCLE_STATES.join(", ")}]`);
    }
    const type = req.query.get("type");
    if (type !== null && !(PRODUCT_TYPES as readonly string[]).includes(type)) {
      throw ValidationError.single("type", `must be one of [${PRODUCT_TYPES.join(", ")}]`);
    }
    const page = await services.product.list(
      req.ctx,
      {
        lifecycle: (lifecycle as LifecycleState | null) ?? undefined,
        type: (type as ProductType | null) ?? undefined,
        categoryId: (req.query.get("categoryId") as Ulid | null) ?? undefined,
        search: req.query.get("q") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((p) => p.toJSON()) });
  });

  router.get("/products/:id", async (req) =>
    jsonResponse(200, (await services.product.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.patch("/products/:id", async (req) => {
    const body = asRecord(req.body);
    const product = await services.product.updateDetails(req.ctx, req.params["id"] as Ulid, {
      name: optionalString(body, "name"),
      description: optionalString(body, "description"),
    });
    return jsonResponse(200, product.toJSON());
  });

  router.put("/products/:id/attributes", async (req) => {
    const body = asRecord(req.body);
    const values = optionalAttributeMap(body, "values");
    if (!values) throw ValidationError.single("values", "attribute value object is required");
    const product = await services.product.setAttributes(req.ctx, req.params["id"] as Ulid, values);
    return jsonResponse(200, product.toJSON());
  });

  router.post("/products/:id/category", async (req) => {
    const body = asRecord(req.body);
    const product = await services.product.assignCategory(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "categoryId") as Ulid,
    );
    return jsonResponse(200, product.toJSON());
  });

  router.post("/products/:id/lifecycle", async (req) => {
    const body = asRecord(req.body);
    const product = await services.product.transitionLifecycle(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<LifecycleState>(body, "to", LIFECYCLE_STATES),
      optionalString(body, "reason"),
    );
    return jsonResponse(200, product.toJSON());
  });

  router.post("/products/:id/variants", async (req) => {
    const body = asRecord(req.body);
    const costBody = body["standardCost"];
    let standardCost: { amountMinor: number; currency: string } | undefined;
    if (costBody !== undefined) {
      const record = asRecord(costBody);
      standardCost = {
        amountMinor: requiredNumber(record, "amountMinor"),
        currency: requiredString(record, "currency"),
      };
    }
    const variant = await services.product.addVariant(req.ctx, {
      productId: req.params["id"] as Ulid,
      sku: optionalString(body, "sku"),
      axisValues: requiredStringMap(body, "axisValues"),
      attributes: optionalAttributeMap(body, "attributes"),
      standardCost,
    });
    return jsonResponse(201, variant);
  });

  router.post("/products/:id/variants/:variantId/discontinue", async (req) => {
    const product = await services.product.discontinueVariant(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["variantId"] as Ulid,
    );
    return jsonResponse(200, product.toJSON());
  });

  router.post("/products/:id/cost", async (req) => {
    const body = asRecord(req.body);
    const product = await services.product.setStandardCost(req.ctx, req.params["id"] as Ulid, {
      amountMinor: requiredNumber(body, "amountMinor"),
      currency: requiredString(body, "currency"),
      variantId: optionalString(body, "variantId") as Ulid | undefined,
    });
    return jsonResponse(200, product.toJSON());
  });

  router.get("/skus/:sku", async (req) => {
    const resolution = await services.product.resolveSku(req.ctx, req.params["sku"]!);
    return jsonResponse(200, {
      product: resolution.product.toJSON(),
      variant: resolution.variant,
    });
  });
}

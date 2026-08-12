import type { IsoDateTime, Ulid } from "@enterprise-suite/shared-kernel";
import {
  ECO_PRIORITIES,
  ECO_REASONS,
  type EcoChange,
  type EcoPriority,
  type EcoReason,
  type EcoStatus,
} from "../../domain/eco.js";
import { LIFECYCLE_STATES, type LifecycleState } from "../../domain/lifecycle.js";
import { ValidationError } from "../../domain/errors.js";
import type { PlmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalAttributeMap,
  optionalNumber,
  optionalString,
  pageFromQuery,
  requiredEnum,
  requiredString,
} from "../validate.js";

const CHANGE_KINDS = ["bom_release", "lifecycle_transition", "attribute_update", "variant_discontinue"] as const;

function parseChange(raw: unknown): EcoChange {
  const body = asRecord(raw);
  const kind = requiredEnum<(typeof CHANGE_KINDS)[number]>(body, "kind", CHANGE_KINDS);
  switch (kind) {
    case "bom_release": {
      const effectiveFrom = requiredString(body, "effectiveFrom");
      if (Number.isNaN(Date.parse(effectiveFrom))) {
        throw ValidationError.single("change.effectiveFrom", "must be an ISO date-time");
      }
      const effectiveTo = optionalString(body, "effectiveTo");
      if (effectiveTo !== undefined && Number.isNaN(Date.parse(effectiveTo))) {
        throw ValidationError.single("change.effectiveTo", "must be an ISO date-time");
      }
      return {
        kind,
        bomRevisionId: requiredString(body, "bomRevisionId") as Ulid,
        effectiveFrom: effectiveFrom as IsoDateTime,
        effectiveTo: effectiveTo as IsoDateTime | undefined,
      };
    }
    case "lifecycle_transition":
      return {
        kind,
        to: requiredEnum<LifecycleState>(body, "to", LIFECYCLE_STATES),
        reason: optionalString(body, "reason"),
      };
    case "attribute_update": {
      const values = optionalAttributeMap(body, "values");
      if (!values) throw ValidationError.single("change.values", "attribute value object is required");
      return { kind, values };
    }
    case "variant_discontinue":
      return { kind, variantId: requiredString(body, "variantId") as Ulid };
  }
}

export function registerEcoRoutes(router: Router, container: PlmContainer): void {
  const { services } = container;

  router.post("/ecos", async (req) => {
    const body = asRecord(req.body);
    const eco = await services.eco.create(req.ctx, {
      title: requiredString(body, "title"),
      description: optionalString(body, "description"),
      reason: requiredEnum<EcoReason>(body, "reason", ECO_REASONS),
      priority: body["priority"] !== undefined ? requiredEnum<EcoPriority>(body, "priority", ECO_PRIORITIES) : undefined,
      requiredApprovals: optionalNumber(body, "requiredApprovals"),
    });
    return jsonResponse(201, eco.toJSON());
  });

  router.get("/ecos", async (req) => {
    const status = req.query.get("status");
    const allowed = ["draft", "submitted", "approved", "rejected", "implemented", "cancelled"];
    if (status !== null && !allowed.includes(status)) {
      throw ValidationError.single("status", `must be one of [${allowed.join(", ")}]`);
    }
    const page = await services.eco.list(
      req.ctx,
      {
        status: (status as EcoStatus | null) ?? undefined,
        productId: (req.query.get("productId") as Ulid | null) ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((e) => e.toJSON()) });
  });

  router.get("/ecos/:id", async (req) =>
    jsonResponse(200, (await services.eco.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/ecos/:id/items", async (req) => {
    const body = asRecord(req.body);
    const item = await services.eco.addItem(req.ctx, req.params["id"] as Ulid, {
      productId: requiredString(body, "productId") as Ulid,
      change: parseChange(body["change"]),
      description: optionalString(body, "description"),
    });
    return jsonResponse(201, item);
  });

  router.delete("/ecos/:id/items/:itemId", async (req) => {
    await services.eco.removeItem(req.ctx, req.params["id"] as Ulid, req.params["itemId"] as Ulid);
    return jsonResponse(204);
  });

  router.post("/ecos/:id/submit", async (req) =>
    jsonResponse(200, (await services.eco.submit(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.post("/ecos/:id/approve", async (req) => {
    const body = asRecord(req.body ?? {});
    const eco = await services.eco.approve(req.ctx, req.params["id"] as Ulid, optionalString(body, "comment"));
    return jsonResponse(200, eco.toJSON());
  });

  router.post("/ecos/:id/reject", async (req) => {
    const body = asRecord(req.body);
    const eco = await services.eco.reject(req.ctx, req.params["id"] as Ulid, requiredString(body, "comment"));
    return jsonResponse(200, eco.toJSON());
  });

  router.post("/ecos/:id/cancel", async (req) => {
    const body = asRecord(req.body);
    const eco = await services.eco.cancel(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, eco.toJSON());
  });

  router.post("/ecos/:id/implement", async (req) =>
    jsonResponse(200, (await services.eco.implement(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );
}

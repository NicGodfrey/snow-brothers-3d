import type { ChannelService } from "../../application/channel-service.js";
import type { Router } from "../router.js";
import {
  asRecord,
  optionalString,
  pageFromQuery,
  requireNumber,
  requireString,
} from "../validation.js";

export function registerChannelRoutes(router: Router, channels: ChannelService): void {
  router.post("/channels", ({ ctx, body }) => {
    const b = asRecord(body);
    const channel = channels.create(ctx, {
      name: requireString(b, "name"),
      code: requireString(b, "code"),
      kind: requireString(b, "kind"),
      costModel: requireString(b, "costModel"),
      unitCostMinor: requireNumber(b, "unitCostMinor"),
      currency: requireString(b, "currency"),
      description: optionalString(b, "description"),
    });
    return { status: 201, body: channel };
  });

  router.get("/channels", ({ ctx, query }) => ({
    body: channels.list(ctx, pageFromQuery(query), query.get("active") === "true"),
  }));

  router.get("/channels/:id", ({ ctx, params }) => ({
    body: channels.get(ctx, params.id!),
  }));

  router.post("/channels/:id/cost-model", ({ ctx, params, body }) => {
    const b = asRecord(body);
    return {
      body: channels.changeCostModel(
        ctx,
        params.id!,
        requireString(b, "costModel"),
        requireNumber(b, "unitCostMinor"),
        requireString(b, "currency"),
      ),
    };
  });

  router.post("/channels/:id/deactivate", ({ ctx, params }) => ({
    body: channels.deactivate(ctx, params.id!),
  }));

  router.post("/channels/:id/reactivate", ({ ctx, params }) => ({
    body: channels.reactivate(ctx, params.id!),
  }));
}

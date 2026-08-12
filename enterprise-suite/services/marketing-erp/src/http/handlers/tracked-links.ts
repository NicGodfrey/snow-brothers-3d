import { NotFoundError } from "@enterprise-suite/shared-kernel";
import type { TrackedLinkService } from "../../application/tracked-link-service.js";
import { buildTrackingUrl, normalizeUtm, parseUtmFromUrl } from "../../domain/utm.js";
import type { Router } from "../router.js";
import { asRecord, optionalString, requireString, utmFromBody } from "../validation.js";

export function registerTrackedLinkRoutes(router: Router, links: TrackedLinkService): void {
  router.post("/tracked-links", ({ ctx, body }) => {
    const b = asRecord(body);
    return {
      status: 201,
      body: links.create(ctx, {
        destinationUrl: requireString(b, "destinationUrl"),
        utm: utmFromBody(b, "utm", true)!,
        shortCode: optionalString(b, "shortCode"),
        campaignId: optionalString(b, "campaignId"),
        channelId: optionalString(b, "channelId"),
      }),
    };
  });

  router.get("/tracked-links", ({ ctx }) => ({ body: links.list(ctx) }));

  router.get("/tracked-links/:code", ({ ctx, params }) => {
    const link = links.getByCode(ctx, params.code!);
    if (!link) throw new NotFoundError("TrackedLink", params.code!);
    return { body: link };
  });

  router.post("/tracked-links/:code/click", ({ ctx, params, body }) => {
    const b = asRecord(body ?? {});
    return { body: links.click(ctx, params.code!, optionalString(b, "leadId")) };
  });

  router.post("/tracked-links/:code/deactivate", ({ ctx, params }) => {
    const link = links.getByCode(ctx, params.code!);
    if (!link) throw new NotFoundError("TrackedLink", params.code!);
    return { body: links.deactivate(ctx, link.id) };
  });

  /** Redirect endpoint a browser would hit: records the click, 302s to the target. */
  router.get("/t/:code", ({ ctx, params, query }) => {
    const result = links.click(ctx, params.code!, query.get("leadId") ?? undefined);
    return { status: 302, headers: { location: result.redirectTo }, body: result };
  });

  // --- Stateless UTM utilities ------------------------------------------------

  router.post("/utm/parse", ({ body }) => {
    const b = asRecord(body);
    const utm = parseUtmFromUrl(requireString(b, "url"));
    return utm
      ? { body: utm }
      : { status: 422, body: { error: "URL does not carry the mandatory utm parameters" } };
  });

  router.post("/utm/build", ({ body }) => {
    const b = asRecord(body);
    const utm = normalizeUtm(utmFromBody(b, "utm", true)!);
    return { body: { url: buildTrackingUrl(requireString(b, "baseUrl"), utm), utm } };
  });
}

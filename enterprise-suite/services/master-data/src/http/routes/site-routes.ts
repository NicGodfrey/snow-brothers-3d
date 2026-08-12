import type { Ulid } from "@enterprise-suite/shared-kernel";
import { SITE_ROLES, type SiteRole } from "../../domain/site.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  numberQuery,
  optionalString,
  pageFromQuery,
  requiredAddress,
  requiredEnum,
  requiredEnumArray,
  requiredQuery,
  requiredString,
  optionalStringMap,
} from "../validate.js";

/** Customer sites: roles, effective-dated addresses, primaries, geo lookup. */
export function registerSiteRoutes(router: Router, container: MasterDataContainer): void {
  const { site } = container.services;

  router.get("/sites", async (req) => {
    const page = await site.list(
      req.ctx,
      {
        customerId: (req.query.get("customerId") as Ulid | null) ?? undefined,
        role: (req.query.get("role") as SiteRole | null) ?? undefined,
        countryCode: req.query.get("country") ?? undefined,
        active: req.query.get("active") === null ? undefined : req.query.get("active") === "true",
        search: req.query.get("search") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, page);
  });

  // Registered before /sites/:id so the static segments win the match.
  router.get("/sites/nearest", async (req) =>
    jsonResponse(
      200,
      await site.nearest(
        req.ctx,
        { latitude: numberQuery(req.query, "lat"), longitude: numberQuery(req.query, "lon") },
        {
          radiusKm: req.query.get("radiusKm") ? Number(req.query.get("radiusKm")) : undefined,
          role: (req.query.get("role") as SiteRole | null) ?? undefined,
          limit: req.query.get("limit") ? Number(req.query.get("limit")) : undefined,
        },
      ),
    ),
  );

  /** The site order entry should default to for a role. */
  router.get("/sites/resolve", async (req) =>
    jsonResponse(
      200,
      await site.resolveForRole(
        req.ctx,
        requiredQuery(req.query, "customerId") as Ulid,
        requiredQuery(req.query, "role") as SiteRole,
      ),
    ),
  );

  router.post("/sites", async (req) => {
    const body = asRecord(req.body);
    const created = await site.create(req.ctx, {
      customerId: requiredString(body, "customerId") as Ulid,
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      roles: requiredEnumArray<SiteRole>(body, "roles", SITE_ROLES),
      address: requiredAddress(body),
      effectiveFrom: optionalString(body, "effectiveFrom"),
      timezone: optionalString(body, "timezone"),
      taxJurisdictionCode: optionalString(body, "taxJurisdictionCode"),
      deliveryInstructions: optionalString(body, "deliveryInstructions"),
      gln: optionalString(body, "gln"),
      externalIds: optionalStringMap(body, "externalIds"),
      primaryForRoles: body["primaryForRoles"] === undefined
        ? undefined
        : requiredEnumArray<SiteRole>(body, "primaryForRoles", SITE_ROLES),
    });
    return jsonResponse(201, created);
  });

  router.get("/sites/:id", async (req) =>
    jsonResponse(200, await site.get(req.ctx, req.params["id"] as Ulid)),
  );

  router.patch("/sites/:id", async (req) => {
    const body = asRecord(req.body);
    const updated = await site.updateDetails(req.ctx, req.params["id"] as Ulid, {
      name: optionalString(body, "name"),
      timezone: optionalString(body, "timezone"),
      taxJurisdictionCode: optionalString(body, "taxJurisdictionCode"),
      deliveryInstructions: optionalString(body, "deliveryInstructions"),
      gln: optionalString(body, "gln"),
    });
    return jsonResponse(200, updated);
  });

  /** The address effective on a date; defaults to the current one. */
  router.get("/sites/:id/address", async (req) => {
    const found = await site.get(req.ctx, req.params["id"] as Ulid);
    const asOf = req.query.get("asOf");
    return jsonResponse(200, {
      address: asOf ? found.addressAt(asOf) : found.address,
      history: found.addressHistory,
    });
  });

  router.post("/sites/:id/address", async (req) => {
    const body = asRecord(req.body);
    const address = await site.changeAddress(
      req.ctx,
      req.params["id"] as Ulid,
      requiredAddress(body),
      optionalString(body, "effectiveFrom"),
      optionalString(body, "reason"),
    );
    return jsonResponse(200, address);
  });

  router.post("/sites/:id/roles", async (req) => {
    const body = asRecord(req.body);
    const updated = await site.setRoles(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnumArray<SiteRole>(body, "roles", SITE_ROLES),
    );
    return jsonResponse(200, updated);
  });

  router.post("/sites/:id/primary", async (req) => {
    const body = asRecord(req.body);
    const updated = await site.setPrimary(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<SiteRole>(body, "role", SITE_ROLES),
    );
    return jsonResponse(200, updated);
  });

  router.post("/sites/:id/deactivate", async (req) => {
    const body = asRecord(req.body);
    const updated = await site.deactivate(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, updated);
  });

  router.post("/sites/:id/reactivate", async (req) =>
    jsonResponse(200, await site.reactivate(req.ctx, req.params["id"] as Ulid)),
  );
}

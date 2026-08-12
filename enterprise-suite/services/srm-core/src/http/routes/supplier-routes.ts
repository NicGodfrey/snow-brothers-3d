import type { Ulid } from "@enterprise-suite/shared-kernel";
import { DIVERSITY_FLAGS, type Address, type DiversityFlag } from "../../domain/common.js";
import {
  CONTACT_ROLES,
  SITE_TYPES,
  SUPPLIER_CLASSIFICATIONS,
  SUPPLIER_STATUSES,
  type ContactRole,
  type SiteType,
  type SupplierClassification,
  type SupplierStatus,
} from "../../domain/supplier.js";
import type { SrmContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  nullableString,
  optionalBoolean,
  optionalId,
  optionalNumber,
  optionalString,
  optionalStringArray,
  pageFromQuery,
  queryEnum,
  queryId,
  requiredEnum,
  requiredObject,
  requiredString,
} from "../validate.js";

function parseAddress(raw: Record<string, unknown>): Address {
  return {
    line1: requiredString(raw, "line1"),
    line2: optionalString(raw, "line2"),
    city: requiredString(raw, "city"),
    region: optionalString(raw, "region"),
    postalCode: optionalString(raw, "postalCode"),
    countryCode: requiredString(raw, "countryCode"),
  };
}

export function registerSupplierRoutes(router: Router, container: SrmContainer): void {
  const { services } = container;

  router.post("/suppliers", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.register(req.ctx, {
      code: requiredString(body, "code"),
      legalName: requiredString(body, "legalName"),
      countryCode: requiredString(body, "countryCode"),
      tradeName: optionalString(body, "tradeName"),
      taxId: optionalString(body, "taxId"),
      dunsNumber: optionalString(body, "dunsNumber"),
      registrationNumber: optionalString(body, "registrationNumber"),
      website: optionalString(body, "website"),
      defaultCurrency: optionalString(body, "defaultCurrency"),
      paymentTermsCode: optionalString(body, "paymentTermsCode"),
      defaultIncoterm: optionalString(body, "defaultIncoterm"),
      parentSupplierId: optionalId(body, "parentSupplierId"),
      tags: optionalStringArray(body, "tags"),
    });
    return jsonResponse(201, supplier.toJSON());
  });

  router.get("/suppliers", async (req) => {
    const page = await services.supplier.list(
      req.ctx,
      {
        status: queryEnum<SupplierStatus>(req.query, "status", SUPPLIER_STATUSES),
        classification: queryEnum<SupplierClassification>(req.query, "classification", SUPPLIER_CLASSIFICATIONS),
        categoryId: queryId(req.query, "categoryId"),
        countryCode: req.query.get("countryCode") ?? undefined,
        tag: req.query.get("tag") ?? undefined,
        parentSupplierId: queryId(req.query, "parentSupplierId"),
        search: req.query.get("search") ?? undefined,
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, { ...page, items: page.items.map((supplier) => supplier.toJSON()) });
  });

  router.get("/suppliers/:id", async (req) =>
    jsonResponse(200, (await services.supplier.get(req.ctx, req.params["id"] as Ulid)).toJSON()),
  );

  router.get("/suppliers/by-code/:code", async (req) =>
    jsonResponse(200, (await services.supplier.getByCode(req.ctx, req.params["code"]!)).toJSON()),
  );

  /** 360° roll-up for a supplier detail screen. */
  router.get("/suppliers/:id/overview", async (req) => {
    const overview = await services.eligibility.overview(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, { ...overview, supplier: overview.supplier.toJSON() });
  });

  router.get("/suppliers/:id/group", async (req) => {
    const group = await services.supplier.group(req.ctx, req.params["id"] as Ulid);
    return jsonResponse(200, {
      parent: group.parent.toJSON(),
      children: group.children.map((child) => child.toJSON()),
    });
  });

  router.patch("/suppliers/:id", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.updateProfile(req.ctx, req.params["id"] as Ulid, {
      legalName: optionalString(body, "legalName"),
      tradeName: nullableString(body, "tradeName"),
      taxId: nullableString(body, "taxId"),
      dunsNumber: nullableString(body, "dunsNumber"),
      registrationNumber: nullableString(body, "registrationNumber"),
      website: nullableString(body, "website"),
      defaultCurrency: optionalString(body, "defaultCurrency"),
      paymentTermsCode: optionalString(body, "paymentTermsCode"),
      defaultIncoterm: nullableString(body, "defaultIncoterm"),
      parentSupplierId: nullableString(body, "parentSupplierId") as Ulid | null | undefined,
      tags: optionalStringArray(body, "tags"),
    });
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/classify", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.classify(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<SupplierClassification>(body, "classification", SUPPLIER_CLASSIFICATIONS),
      optionalString(body, "rationale"),
    );
    return jsonResponse(200, supplier.toJSON());
  });

  // --- lifecycle -----------------------------------------------------------

  router.post("/suppliers/:id/activate", async (req) => {
    const body = asRecord(req.body ?? {});
    const supplier = await services.supplier.activate(req.ctx, req.params["id"] as Ulid, optionalString(body, "reason"));
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/suspend", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.suspend(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/reinstate", async (req) => {
    const body = asRecord(req.body ?? {});
    const supplier = await services.supplier.reinstate(req.ctx, req.params["id"] as Ulid, optionalString(body, "reason"));
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/block", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.block(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/unblock", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.unblock(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/deactivate", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.deactivate(req.ctx, req.params["id"] as Ulid, requiredString(body, "reason"));
    return jsonResponse(200, supplier.toJSON());
  });

  // --- sites ---------------------------------------------------------------

  router.post("/suppliers/:id/sites", async (req) => {
    const body = asRecord(req.body);
    const site = await services.supplier.addSite(req.ctx, req.params["id"] as Ulid, {
      code: requiredString(body, "code"),
      name: requiredString(body, "name"),
      type: requiredEnum<SiteType>(body, "type", SITE_TYPES),
      address: parseAddress(requiredObject(body, "address")),
      isPrimary: optionalBoolean(body, "isPrimary"),
      capabilities: optionalStringArray(body, "capabilities"),
      leadTimeDays: optionalNumber(body, "leadTimeDays"),
      timezone: optionalString(body, "timezone"),
    });
    return jsonResponse(201, site);
  });

  router.patch("/suppliers/:id/sites/:siteId", async (req) => {
    const body = asRecord(req.body);
    const address = body["address"] === undefined ? undefined : parseAddress(requiredObject(body, "address"));
    const site = await services.supplier.updateSite(req.ctx, req.params["id"] as Ulid, req.params["siteId"] as Ulid, {
      name: optionalString(body, "name"),
      type: body["type"] === undefined ? undefined : requiredEnum<SiteType>(body, "type", SITE_TYPES),
      address,
      capabilities: optionalStringArray(body, "capabilities"),
      leadTimeDays: body["leadTimeDays"] === null ? null : optionalNumber(body, "leadTimeDays"),
      timezone: nullableString(body, "timezone"),
    });
    return jsonResponse(200, site);
  });

  router.post("/suppliers/:id/sites/:siteId/primary", async (req) => {
    const supplier = await services.supplier.setPrimarySite(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["siteId"] as Ulid,
    );
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/sites/:siteId/deactivate", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.deactivateSite(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["siteId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, supplier.toJSON());
  });

  // --- contacts ------------------------------------------------------------

  router.post("/suppliers/:id/contacts", async (req) => {
    const body = asRecord(req.body);
    const contact = await services.supplier.addContact(req.ctx, req.params["id"] as Ulid, {
      name: requiredString(body, "name"),
      email: requiredString(body, "email"),
      role: requiredEnum<ContactRole>(body, "role", CONTACT_ROLES),
      phone: optionalString(body, "phone"),
      title: optionalString(body, "title"),
      siteId: optionalId(body, "siteId"),
    });
    return jsonResponse(201, contact);
  });

  router.delete("/suppliers/:id/contacts/:contactId", async (req) => {
    await services.supplier.removeContact(req.ctx, req.params["id"] as Ulid, req.params["contactId"] as Ulid);
    return jsonResponse(204);
  });

  // --- banking & diversity -------------------------------------------------

  router.post("/suppliers/:id/bank-accounts", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.addBankAccount(req.ctx, req.params["id"] as Ulid, {
      label: requiredString(body, "label"),
      bankName: requiredString(body, "bankName"),
      countryCode: requiredString(body, "countryCode"),
      currency: requiredString(body, "currency"),
      accountNumber: requiredString(body, "accountNumber"),
    });
    return jsonResponse(201, supplier.toJSON());
  });

  router.post("/suppliers/:id/bank-accounts/:accountId/verify", async (req) => {
    const body = asRecord(req.body ?? {});
    const supplier = await services.supplier.verifyBankAccount(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["accountId"] as Ulid,
      optionalBoolean(body, "makePrimary") ?? true,
    );
    return jsonResponse(200, supplier.toJSON());
  });

  router.post("/suppliers/:id/diversity", async (req) => {
    const body = asRecord(req.body);
    const supplier = await services.supplier.declareDiversity(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<DiversityFlag>(body, "flag", DIVERSITY_FLAGS),
    );
    return jsonResponse(200, supplier.toJSON());
  });

  // --- category panel ------------------------------------------------------

  router.get("/suppliers/:id/panel", async (req) =>
    jsonResponse(200, await services.supplier.panel(req.ctx, req.params["id"] as Ulid)),
  );

  router.post("/suppliers/:id/categories", async (req) => {
    const body = asRecord(req.body);
    const assignment = await services.supplier.assignCategory(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "categoryId") as Ulid,
      optionalString(body, "note"),
    );
    return jsonResponse(201, assignment);
  });

  router.post("/suppliers/:id/categories/:categoryId/approve", async (req) => {
    const body = asRecord(req.body ?? {});
    const assignment = await services.supplier.approveCategory(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["categoryId"] as Ulid,
      optionalString(body, "note"),
    );
    return jsonResponse(200, assignment);
  });

  router.post("/suppliers/:id/categories/:categoryId/restrict", async (req) => {
    const body = asRecord(req.body);
    const assignment = await services.supplier.restrictCategory(
      req.ctx,
      req.params["id"] as Ulid,
      req.params["categoryId"] as Ulid,
      requiredString(body, "reason"),
    );
    return jsonResponse(200, assignment);
  });
}

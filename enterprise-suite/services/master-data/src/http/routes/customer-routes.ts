import type { Ulid } from "@enterprise-suite/shared-kernel";
import {
  CONTACT_ROLES,
  CUSTOMER_CLASSIFICATIONS,
  CUSTOMER_STATUSES,
  PARTY_TYPES,
  type ContactRole,
  type CustomerClassification,
  type CustomerStatus,
  type PartyType,
} from "../../domain/customer.js";
import { IDENTIFIER_SCHEMES, type IdentifierScheme } from "../../domain/identifiers.js";
import type { MasterDataContainer } from "../../infrastructure/container.js";
import { jsonResponse, type Router } from "../router.js";
import {
  asRecord,
  optionalAddress,
  optionalEnum,
  optionalEnumArray,
  optionalString,
  optionalStringArray,
  optionalStringMap,
  optionalBoolean,
  pageFromQuery,
  requiredAddress,
  requiredEnum,
  requiredInteger,
  requiredString,
} from "../validate.js";

/** Customer master: profile, status, identifiers, contacts, terms, merges. */
export function registerCustomerRoutes(router: Router, container: MasterDataContainer): void {
  const { customer, site } = container.services;

  router.get("/customers", async (req) => {
    const page = await customer.list(
      req.ctx,
      {
        status: (req.query.get("status") as CustomerStatus | null) ?? undefined,
        classification: (req.query.get("classification") as CustomerClassification | null) ?? undefined,
        countryCode: req.query.get("country") ?? undefined,
        segmentCode: req.query.get("segment") ?? undefined,
        industryCode: req.query.get("industry") ?? undefined,
        tag: req.query.get("tag") ?? undefined,
        search: req.query.get("search") ?? undefined,
        includeMerged: req.query.get("includeMerged") === "true",
      },
      pageFromQuery(req.query),
    );
    return jsonResponse(200, page);
  });

  router.post("/customers", async (req) => {
    const body = asRecord(req.body);
    const created = await customer.create(req.ctx, {
      number: optionalString(body, "number"),
      legalName: requiredString(body, "legalName"),
      tradingName: optionalString(body, "tradingName"),
      partyType: optionalEnum<PartyType>(body, "partyType", PARTY_TYPES),
      classification: requiredEnum<CustomerClassification>(
        body,
        "classification",
        CUSTOMER_CLASSIFICATIONS,
      ),
      registeredAddress: requiredAddress(body, "registeredAddress"),
      currency: optionalString(body, "currency"),
      industryCode: optionalString(body, "industryCode"),
      segmentCode: optionalString(body, "segmentCode"),
      taxCategoryCode: optionalString(body, "taxCategoryCode"),
      parentId: optionalString(body, "parentId") as Ulid | undefined,
      tags: optionalStringArray(body, "tags"),
      externalIds: optionalStringMap(body, "externalIds"),
      rejectDuplicates: optionalBoolean(body, "rejectDuplicates"),
    });
    return jsonResponse(201, created);
  });

  router.get("/customers/by-number/:number", async (req) =>
    jsonResponse(200, await customer.getByNumber(req.ctx, req.params["number"]!)),
  );

  router.get("/customers/:id", async (req) =>
    jsonResponse(200, await customer.get(req.ctx, req.params["id"] as Ulid)),
  );

  /** Follows merge history to the surviving record. */
  router.get("/customers/:id/resolved", async (req) =>
    jsonResponse(200, await customer.resolve(req.ctx, req.params["id"] as Ulid)),
  );

  router.patch("/customers/:id", async (req) => {
    const body = asRecord(req.body);
    const updated = await customer.updateProfile(req.ctx, req.params["id"] as Ulid, {
      legalName: optionalString(body, "legalName"),
      tradingName: optionalString(body, "tradingName"),
      classification: optionalEnum<CustomerClassification>(
        body,
        "classification",
        CUSTOMER_CLASSIFICATIONS,
      ),
      industryCode: optionalString(body, "industryCode"),
      segmentCode: optionalString(body, "segmentCode"),
      taxCategoryCode: optionalString(body, "taxCategoryCode"),
      registeredAddress: optionalAddress(body, "registeredAddress"),
      tags: optionalStringArray(body, "tags"),
    });
    return jsonResponse(200, updated);
  });

  router.post("/customers/:id/status", async (req) => {
    const body = asRecord(req.body);
    const updated = await customer.changeStatus(
      req.ctx,
      req.params["id"] as Ulid,
      requiredEnum<CustomerStatus>(body, "status", CUSTOMER_STATUSES),
      optionalString(body, "reason"),
      optionalString(body, "reasonCode"),
    );
    return jsonResponse(200, updated);
  });

  router.post("/customers/:id/identifiers", async (req) => {
    const body = asRecord(req.body);
    const identifier = await customer.addIdentifier(req.ctx, req.params["id"] as Ulid, {
      scheme: requiredEnum<IdentifierScheme>(body, "scheme", IDENTIFIER_SCHEMES),
      value: requiredString(body, "value"),
      countryCode: optionalString(body, "countryCode"),
    });
    return jsonResponse(201, identifier);
  });

  router.delete("/customers/:id/identifiers/:scheme/:value", async (req) =>
    jsonResponse(
      200,
      await customer.removeIdentifier(
        req.ctx,
        req.params["id"] as Ulid,
        req.params["scheme"] as IdentifierScheme,
        req.params["value"]!,
      ),
    ),
  );

  router.post("/customers/:id/contacts", async (req) => {
    const body = asRecord(req.body);
    const contact = await customer.addContact(req.ctx, req.params["id"] as Ulid, {
      name: requiredString(body, "name"),
      email: optionalString(body, "email"),
      phone: optionalString(body, "phone"),
      jobTitle: optionalString(body, "jobTitle"),
      roles: optionalEnumArray<ContactRole>(body, "roles", CONTACT_ROLES),
      siteId: optionalString(body, "siteId") as Ulid | undefined,
    });
    return jsonResponse(201, contact);
  });

  router.delete("/customers/:id/contacts/:contactId", async (req) =>
    jsonResponse(
      200,
      await customer.removeContact(
        req.ctx,
        req.params["id"] as Ulid,
        req.params["contactId"] as Ulid,
      ),
    ),
  );

  router.post("/customers/:id/terms", async (req) => {
    const body = asRecord(req.body);
    const updated = await customer.assignTerms(req.ctx, req.params["id"] as Ulid, {
      paymentTermCode: optionalString(body, "paymentTermCode"),
      shippingTermCode: optionalString(body, "shippingTermCode"),
      priceListCode: optionalString(body, "priceListCode"),
      incotermPlace: optionalString(body, "incotermPlace"),
    });
    return jsonResponse(200, updated);
  });

  router.post("/customers/:id/credit-limit", async (req) => {
    const body = asRecord(req.body);
    const updated = await customer.setCreditLimit(
      req.ctx,
      req.params["id"] as Ulid,
      { amountMinor: requiredInteger(body, "amountMinor"), currency: requiredString(body, "currency") },
      optionalString(body, "riskRating"),
    );
    return jsonResponse(200, updated);
  });

  router.post("/customers/:id/parent", async (req) => {
    const body = asRecord(req.body ?? {});
    const updated = await customer.setParent(
      req.ctx,
      req.params["id"] as Ulid,
      optionalString(body, "parentId") as Ulid | undefined,
    );
    return jsonResponse(200, updated);
  });

  router.get("/customers/:id/hierarchy", async (req) =>
    jsonResponse(200, await customer.hierarchy(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/customers/:id/duplicates", async (req) =>
    jsonResponse(200, await customer.duplicatesOf(req.ctx, req.params["id"] as Ulid)),
  );

  router.get("/customers/:id/sites", async (req) =>
    jsonResponse(200, await site.forCustomer(req.ctx, req.params["id"] as Ulid)),
  );

  /** Dry run: what a merge would move and which fields disagree. */
  router.post("/customers/:id/merge-plan", async (req) => {
    const body = asRecord(req.body);
    const plan = await customer.planMerge(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "duplicateId") as Ulid,
    );
    return jsonResponse(200, plan);
  });

  router.post("/customers/:id/merge", async (req) => {
    const body = asRecord(req.body);
    const result = await customer.merge(
      req.ctx,
      req.params["id"] as Ulid,
      requiredString(body, "duplicateId") as Ulid,
    );
    return jsonResponse(200, result);
  });
}

import { json, type Router } from "@enterprise-suite/api-gateway";
import { tenantId as toTenantId } from "@enterprise-suite/shared-kernel";
import { TENANT_PLANS, type TenantContact, type TenantPlan } from "../../domain/tenant.js";
import type { AdminContainer } from "../../infrastructure/container.js";
import { commandContext, isPlatformOperator } from "../context.js";
import {
  asRecord,
  optionalNumber,
  optionalString,
  pageFromQuery,
  requiredEnum,
  requiredString,
} from "../validate.js";

/**
 * Tenant administration.
 *
 * Listing and provisioning are cross-tenant operations reserved for platform
 * operators; everything else is scoped to the tenant in the request header,
 * which is what stops a tenant administrator reading a neighbour's record.
 */
export function registerTenantRoutes(router: Router, container: AdminContainer): void {
  const { tenant: tenants } = container.services;

  router.get(
    "/tenants",
    (req) => {
      if (!isPlatformOperator(req)) {
        // A tenant administrator only ever sees their own tenant.
        const own = tenants.require(String(req.ctx.tenantId));
        return json(200, { items: [own.toJSON()], total: 1, page: 1, pageSize: 1 });
      }
      const page = tenants.page(
        {
          status: req.query.get("status") ?? undefined,
          plan: req.query.get("plan") ?? undefined,
          search: req.query.get("q") ?? undefined,
        },
        pageFromQuery(req.query),
      );
      return json(200, { ...page, items: page.items.map((item) => item.toJSON()) });
    },
    "tenants.list",
  );

  router.post(
    "/tenants",
    async (req) => {
      const body = asRecord(req.body);
      const contacts = (body["contacts"] as TenantContact[] | undefined) ?? [];
      const created = await tenants.provision(commandContext(req), {
        key: requiredString(body, "key"),
        name: requiredString(body, "name"),
        plan: (optionalString(body, "plan") as TenantPlan | undefined) ?? undefined,
        settings: body["settings"] as Record<string, never> | undefined,
        contacts,
      });
      return json(201, created.toJSON());
    },
    "tenants.create",
  );

  router.get(
    "/tenants/:tenantKey",
    (req) => json(200, tenants.require(req.params["tenantKey"]!).toJSON()),
    "tenants.get",
  );

  router.patch(
    "/tenants/:tenantKey",
    async (req) => {
      const body = asRecord(req.body);
      const key = req.params["tenantKey"]!;
      const settings = body["settings"];
      if (settings !== undefined) {
        await tenants.updateSettings(commandContext(req), key, asRecord(settings, "settings"));
      }
      const name = optionalString(body, "name");
      if (name !== undefined) await tenants.rename(commandContext(req), key, name);
      return json(200, tenants.require(key).toJSON());
    },
    "tenants.update",
  );

  router.post(
    "/tenants/:tenantKey/activate",
    async (req) => json(200, (await tenants.activate(commandContext(req), req.params["tenantKey"]!)).toJSON()),
    "tenants.activate",
  );

  router.post(
    "/tenants/:tenantKey/suspend",
    async (req) => {
      const body = asRecord(req.body);
      const suspended = await tenants.suspend(
        commandContext(req),
        req.params["tenantKey"]!,
        requiredString(body, "reason"),
      );
      return json(200, suspended.toJSON());
    },
    "tenants.suspend",
  );

  router.post(
    "/tenants/:tenantKey/archive",
    async (req) => json(200, (await tenants.archive(commandContext(req), req.params["tenantKey"]!)).toJSON()),
    "tenants.archive",
  );

  router.post(
    "/tenants/:tenantKey/plan",
    async (req) => {
      const body = asRecord(req.body);
      const plan = requiredEnum(body, "plan", TENANT_PLANS);
      const overrides = body["quotaOverrides"] === undefined
        ? undefined
        : {
            users: optionalNumber(asRecord(body["quotaOverrides"], "quotaOverrides"), "users"),
            webhooks: optionalNumber(asRecord(body["quotaOverrides"], "quotaOverrides"), "webhooks"),
            featureFlags: optionalNumber(
              asRecord(body["quotaOverrides"], "quotaOverrides"),
              "featureFlags",
            ),
          };
      const cleaned = overrides
        ? Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== undefined))
        : undefined;
      const updated = await tenants.changePlan(
        commandContext(req),
        req.params["tenantKey"]!,
        plan,
        cleaned,
      );
      return json(200, updated.toJSON());
    },
    "tenants.change-plan",
  );

  router.get(
    "/tenants/:tenantKey/quotas",
    (req) => json(200, tenants.quotaReport(req.params["tenantKey"]!)),
    "tenants.quotas",
  );

  router.post(
    "/tenants/:tenantKey/contacts",
    async (req) => {
      const body = asRecord(req.body);
      const contact: TenantContact = {
        kind: requiredEnum(body, "kind", ["billing", "technical", "security"] as const),
        name: requiredString(body, "name"),
        email: requiredString(body, "email"),
      };
      const updated = await tenants.setContact(commandContext(req), req.params["tenantKey"]!, contact);
      return json(200, updated.toJSON());
    },
    "tenants.set-contact",
  );

  /** Everything the console's landing page needs in one request. */
  router.get(
    "/overview",
    (req) => {
      const key = String(req.ctx.tenantId);
      const record = tenants.require(key);
      const id = toTenantId(key);
      const users = container.services.user.list(id);
      const flags = container.services.featureFlag.list(id, { archived: false });
      const webhooks = container.services.webhook.list(id);
      const sets = container.services.referenceData.list(id);

      return json(200, {
        tenant: record.toJSON(),
        quotas: tenants.quotaReport(key),
        users: {
          total: users.length,
          active: users.filter((user) => user.status === "active").length,
          invited: users.filter((user) => user.status === "invited").length,
          expiredInvitations: container.services.user.expiredInvitations(id).length,
        },
        roles: container.services.role.list(id).length,
        referenceData: {
          sets: sets.length,
          published: sets.filter((set) => set.status === "published").length,
          drafts: sets.filter((set) => set.status === "draft").length,
        },
        webhooks: {
          total: webhooks.length,
          active: webhooks.filter((webhook) => webhook.status === "active").length,
          paused: webhooks.filter((webhook) => webhook.status === "paused").length,
          deadLetters: container.services.webhook.deadLetters(id).length,
        },
        featureFlags: {
          total: flags.length,
          enabled: flags.filter((flag) => flag.enabled).length,
          rollingOut: flags.filter((flag) => flag.rolloutPercentage > 0 && flag.rolloutPercentage < 100)
            .length,
        },
        audit: container.services.audit.summary(id),
      });
    },
    "tenants.overview",
  );
}

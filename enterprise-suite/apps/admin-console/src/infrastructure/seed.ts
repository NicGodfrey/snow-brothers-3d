import { tenantId as toTenantId, type TenantId } from "@enterprise-suite/shared-kernel";
import type { CommandContext } from "../application/ports.js";
import type { AdminContainer } from "./container.js";

/**
 * Demo fixture: one operational tenant with the configuration a real customer
 * would have on day one — administrators, a custom role, published reference
 * data, a webhook subscription and a rollout in progress.
 */

export interface SeedResult {
  readonly tenantKey: string;
  readonly tenantId: TenantId;
  readonly adminEmail: string;
  readonly webhookId: string;
  readonly inviteTokens: Record<string, string>;
}

export const SEED_TENANT_KEY = "northwind";

export async function seedDemoData(
  container: AdminContainer,
  tenantKey = SEED_TENANT_KEY,
): Promise<SeedResult> {
  const platform: CommandContext = {
    tenantId: toTenantId(tenantKey),
    actor: "seed-bot",
    roles: ["platform-admin"],
    requestId: "req_seed",
  };
  const { tenant, user, role, referenceData, webhook, featureFlag } = container.services;

  await tenant.provision(platform, {
    key: tenantKey,
    name: "Northwind Manufacturing",
    plan: "standard",
    settings: { locale: "en-GB", timeZone: "Europe/London", defaultCurrency: "GBP" },
    contacts: [
      { kind: "billing", name: "Priya Raman", email: "billing@northwind.example" },
      { kind: "technical", name: "Tom Okafor", email: "ops@northwind.example" },
    ],
  });
  await tenant.activate(platform, tenantKey);

  const ctx: CommandContext = {
    tenantId: toTenantId(tenantKey),
    actor: "seed-bot",
    roles: ["tenant-admin"],
    requestId: "req_seed",
  };

  await role.create(ctx, {
    code: "integration-engineer",
    name: "Integration Engineer",
    description: "Manages webhooks and reads configuration.",
    permissions: ["webhook:admin", "reference-data:read", "feature-flag:read"],
    inheritsFrom: "tenant-operator",
  });

  const inviteTokens: Record<string, string> = {};
  const admin = await user.invite(ctx, {
    email: "ada@northwind.example",
    displayName: "Ada Whitfield",
    roles: ["tenant-admin"],
    attributes: { department: "operations", site: "leeds" },
  });
  inviteTokens[admin.user.email] = admin.inviteToken;
  await user.acceptInvite(ctx, admin.user.email, admin.inviteToken);

  const engineer = await user.invite(ctx, {
    email: "raj@northwind.example",
    displayName: "Raj Patel",
    roles: ["integration-engineer"],
    attributes: { department: "it", site: "leeds" },
  });
  inviteTokens[engineer.user.email] = engineer.inviteToken;
  await user.acceptInvite(ctx, engineer.user.email, engineer.inviteToken);

  const auditor = await user.invite(ctx, {
    email: "mei@northwind.example",
    displayName: "Mei Lin",
    roles: ["auditor"],
  });
  inviteTokens[auditor.user.email] = auditor.inviteToken;

  await referenceData.createSet(ctx, {
    code: "order-hold-reason",
    name: "Order Hold Reasons",
    description: "Why a sales order is prevented from shipping.",
    entries: [
      { code: "CREDIT", label: "Credit hold", sortOrder: 10 },
      { code: "STOCK", label: "Awaiting stock", sortOrder: 20 },
      { code: "QUALITY", label: "Quality investigation", sortOrder: 30 },
      { code: "EXPORT", label: "Export control review", sortOrder: 40 },
      {
        code: "LEGACY-PRICE",
        label: "Legacy pricing review",
        sortOrder: 90,
        active: false,
        effectiveTo: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  await referenceData.publish(ctx, "order-hold-reason");

  await referenceData.createSet(ctx, {
    code: "site-hierarchy",
    name: "Sites",
    description: "Regions, countries and manufacturing sites.",
    hierarchical: true,
    entries: [
      { code: "EMEA", label: "Europe, Middle East & Africa", sortOrder: 10 },
      { code: "GB", label: "United Kingdom", parentCode: "EMEA", sortOrder: 20 },
      { code: "LEEDS", label: "Leeds Plant", parentCode: "GB", sortOrder: 30 },
      { code: "DERBY", label: "Derby Plant", parentCode: "GB", sortOrder: 40 },
      { code: "AMER", label: "Americas", sortOrder: 50 },
      { code: "US", label: "United States", parentCode: "AMER", sortOrder: 60 },
      { code: "AUSTIN", label: "Austin Plant", parentCode: "US", sortOrder: 70 },
    ],
  });
  await referenceData.publish(ctx, "site-hierarchy");

  const registered = await webhook.register(ctx, {
    name: "Ops event bridge",
    url: "https://hooks.northwind.example/enterprise-suite",
    eventFilters: ["admin.tenant.*", "admin.user.*", "admin.feature-flag.toggled"],
    headers: { "x-environment": "production" },
    retryPolicy: { maxAttempts: 4, initialBackoffMs: 30_000, backoffFactor: 4 },
  });

  await featureFlag.create(ctx, {
    key: "new-order-workspace",
    name: "New order workspace",
    description: "Rolls the redesigned order screen out by site.",
    enabled: true,
    rolloutPercentage: 25,
    tags: ["ux", "sales"],
    rules: [
      {
        description: "Always on for the pilot site",
        priority: 10,
        conditions: [{ attribute: "site", operator: "in", values: ["leeds"] }],
        value: true,
      },
      {
        description: "Never for external contractors",
        priority: 20,
        conditions: [{ attribute: "employmentType", operator: "equals", values: ["contractor"] }],
        value: false,
      },
    ],
  });

  await featureFlag.create(ctx, {
    key: "mrp-parallel-run",
    name: "MRP parallel run",
    description: "Runs the new planning engine alongside the old one.",
    enabled: false,
    tags: ["supply-chain"],
  });

  await featureFlag.create(ctx, {
    key: "invoice-pdf-template",
    name: "Invoice PDF template",
    valueType: "string",
    defaultValue: "classic",
    onValue: "modern",
    offValue: "classic",
    enabled: true,
    tags: ["finance"],
    rules: [
      {
        description: "Enterprise customers get the modern template",
        priority: 10,
        conditions: [{ attribute: "plan", operator: "equals", values: ["enterprise"] }],
        value: "modern",
      },
    ],
  });

  return {
    tenantKey,
    tenantId: toTenantId(tenantKey),
    adminEmail: admin.user.email,
    webhookId: String(registered.webhook.id),
    inviteTokens,
  };
}

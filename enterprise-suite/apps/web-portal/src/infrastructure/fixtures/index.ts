import { MODULE_KEYS, type ModuleKey } from "../../domain/module.js";
import { buildFinanceFixture } from "./finance.js";
import { buildInventoryFixture } from "./inventory.js";
import { buildMarketingFixture } from "./marketing.js";
import { buildPrmFixture } from "./prm.js";
import { buildSalesFixture } from "./sales.js";
import { buildSrmFixture } from "./srm.js";
import type { FixtureBuilder, FixtureContext, ModuleFixture } from "./types.js";

export * from "./types.js";

const BUILDERS: Readonly<Record<ModuleKey, FixtureBuilder>> = {
  sales: buildSalesFixture,
  marketing: buildMarketingFixture,
  inventory: buildInventoryFixture,
  srm: buildSrmFixture,
  prm: buildPrmFixture,
  finance: buildFinanceFixture,
};

export type Dataset = Readonly<Record<ModuleKey, ModuleFixture>>;

/**
 * Datasets are built per tenant and memoised, so the mock backend behaves like
 * a real one: two tenants never see each other's documents, and numbering and
 * currency differ between them.
 */
export function buildDataset(ctx: FixtureContext): Dataset {
  return Object.fromEntries(
    MODULE_KEYS.map((key) => [key, BUILDERS[key](ctx)]),
  ) as Dataset;
}

export interface TenantDatasetOptions {
  readonly currency: string;
  readonly prefix: string;
}

const TENANT_DEFAULTS: Readonly<Record<string, TenantDatasetOptions>> = {
  acme: { currency: "USD", prefix: "ACM" },
  globex: { currency: "EUR", prefix: "GBX" },
};

export function tenantDatasetOptions(tenantId: string): TenantDatasetOptions | undefined {
  return TENANT_DEFAULTS[tenantId];
}

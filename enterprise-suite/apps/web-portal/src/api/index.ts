import type { ModuleKey } from "../domain/module.js";
import { ApiClient, type AuthHeaderProvider, type CallRecord } from "./client.js";
import { FinanceApi } from "./finance.js";
import { InventoryApi } from "./inventory.js";
import { MarketingApi } from "./marketing.js";
import type { ModuleApi } from "./module-api.js";
import { PrmApi } from "./prm.js";
import { SalesApi } from "./sales.js";
import { SrmApi } from "./srm.js";
import type { Transport } from "./types.js";

export * from "./types.js";
export * from "./client.js";
export * from "./module-api.js";
export * from "./sales.js";
export * from "./marketing.js";
export * from "./inventory.js";
export * from "./srm.js";
export * from "./prm.js";
export * from "./finance.js";

/**
 * Client registry. Every module is reachable two ways: by its concrete class
 * (typed domain calls) and through `byModule` (the generic shell contract).
 */

export interface EndpointConfig {
  readonly baseUrl: string;
  readonly timeoutMs?: number;
  readonly retries?: number;
}

export interface ApiClientsOptions {
  readonly endpoints: Readonly<Record<ModuleKey, EndpointConfig>>;
  readonly transport: Transport;
  readonly auth: AuthHeaderProvider;
  readonly onCall?: (record: CallRecord) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly newRequestId?: () => string;
}

export interface ApiClients {
  readonly sales: SalesApi;
  readonly marketing: MarketingApi;
  readonly inventory: InventoryApi;
  readonly srm: SrmApi;
  readonly prm: PrmApi;
  readonly finance: FinanceApi;
  readonly byModule: Readonly<Record<ModuleKey, ModuleApi>>;
}

/**
 * A gateway prefix served by a different upstream than the module's main one
 * (SRM's procurement documents, PRM's channel deal registrations). The sibling
 * base URL is derived from the module endpoint so a single `PORTAL_GATEWAY_URL`
 * keeps configuring everything.
 */
export function siblingBaseUrl(baseUrl: string, fromPrefix: string, toPrefix: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith(fromPrefix)
    ? `${trimmed.slice(0, -fromPrefix.length)}${toPrefix}`
    : `${trimmed}${toPrefix}`;
}

export function createApiClients(options: ApiClientsOptions): ApiClients {
  const build = (service: string, endpoint: EndpointConfig, baseUrl = endpoint.baseUrl): ApiClient =>
    new ApiClient({
      service,
      baseUrl,
      transport: options.transport,
      auth: options.auth,
      defaultTimeoutMs: endpoint.timeoutMs,
      retries: endpoint.retries,
      onCall: options.onCall,
      now: options.now,
      sleep: options.sleep,
      newRequestId: options.newRequestId,
    });

  const { endpoints } = options;
  const procurementHttp = build(
    "procurement-srm",
    endpoints.srm,
    siblingBaseUrl(endpoints.srm.baseUrl, "/api/srm", "/api/procurement"),
  );
  const channelHttp = build(
    "channel-prm",
    endpoints.prm,
    siblingBaseUrl(endpoints.prm.baseUrl, "/api/prm", "/api/channel"),
  );

  const sales = new SalesApi(build("sales-erp", endpoints.sales));
  const marketing = new MarketingApi(build("marketing-erp", endpoints.marketing));
  const inventory = new InventoryApi(build("inventory-wms", endpoints.inventory));
  const srm = new SrmApi(build("srm-core", endpoints.srm), procurementHttp);
  const prm = new PrmApi(build("prm-core", endpoints.prm), channelHttp);
  const finance = new FinanceApi(build("finance-erp", endpoints.finance));

  return {
    sales,
    marketing,
    inventory,
    srm,
    prm,
    finance,
    byModule: { sales, marketing, inventory, srm, prm, finance },
  };
}

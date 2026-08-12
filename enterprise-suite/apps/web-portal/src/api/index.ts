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

export function createApiClients(options: ApiClientsOptions): ApiClients {
  const build = (module: ModuleKey, service: string): ApiClient => {
    const endpoint = options.endpoints[module];
    return new ApiClient({
      service,
      baseUrl: endpoint.baseUrl,
      transport: options.transport,
      auth: options.auth,
      defaultTimeoutMs: endpoint.timeoutMs,
      retries: endpoint.retries,
      onCall: options.onCall,
      now: options.now,
      sleep: options.sleep,
      newRequestId: options.newRequestId,
    });
  };

  const sales = new SalesApi(build("sales", "sales-erp"));
  const marketing = new MarketingApi(build("marketing", "marketing-erp"));
  const inventory = new InventoryApi(build("inventory", "inventory-wms"));
  const procurementHttp = new ApiClient({
    service: "procurement-srm",
    baseUrl:
      options.endpoints.srm.baseUrl.replace(/\/api\/srm\/?$/, "/api/procurement") ||
      "http://127.0.0.1:4100/api/procurement",
    transport: options.transport,
    auth: options.auth,
    defaultTimeoutMs: options.endpoints.srm.timeoutMs,
    retries: options.endpoints.srm.retries,
    onCall: options.onCall,
    now: options.now,
    sleep: options.sleep,
    newRequestId: options.newRequestId,
  });
  const srm = new SrmApi(build("srm", "srm-core"), procurementHttp);
  const prm = new PrmApi(build("prm", "prm-core"));
  const finance = new FinanceApi(build("finance", "finance-erp"));

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

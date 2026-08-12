import { defineService, ServiceCatalog, type UpstreamService } from "../domain/service-catalog.js";

/**
 * Reference upstream catalog for the suite.
 *
 * Ports follow the monorepo convention `41xx`, one per bounded context.
 * `planned: true` marks a context that is designed and routed but not yet
 * deployed: the gateway answers 501 for it and synthesizes its OpenAPI stub
 * instead of pretending the upstream is down.
 */

export interface CatalogOptions {
  /** Origin template; `{port}` is substituted per service. */
  readonly originTemplate?: string;
  /** Force every service to be treated as deployed (used by integration demos). */
  readonly assumeDeployed?: boolean;
}

interface ServiceSeed {
  readonly id: string;
  readonly label: string;
  readonly system: UpstreamService["system"];
  readonly prefix: string;
  readonly port: number;
  readonly critical?: boolean;
  readonly planned?: boolean;
  readonly owner: string;
  readonly tags: readonly string[];
}

const SEEDS: readonly ServiceSeed[] = [
  { id: "identity-access", label: "Identity & Access", system: "Platform", prefix: "/api/iam", port: 4101, critical: true, planned: true, owner: "platform", tags: ["auth", "tenants"] },
  { id: "master-data", label: "Master Data", system: "ERP", prefix: "/api/mdm", port: 4102, critical: true, planned: true, owner: "platform", tags: ["reference"] },
  { id: "sales-erp", label: "Sales ERP", system: "ERP", prefix: "/api/sales", port: 4103, critical: true, owner: "erp-sales", tags: ["quotes", "orders"] },
  { id: "marketing-erp", label: "Marketing ERP", system: "ERP", prefix: "/api/marketing", port: 4104, owner: "erp-marketing", tags: ["campaigns", "leads"] },
  { id: "product-plm", label: "Product PLM", system: "ERP", prefix: "/api/plm", port: 4105, critical: true, owner: "erp-product", tags: ["catalog", "bom"] },
  { id: "supply-chain", label: "Supply Chain", system: "ERP", prefix: "/api/scm", port: 4106, owner: "erp-supply", tags: ["planning", "mrp"] },
  { id: "inventory-wms", label: "Inventory WMS", system: "ERP", prefix: "/api/inventory", port: 4107, critical: true, owner: "erp-inventory", tags: ["stock"] },
  { id: "finance-erp", label: "Finance ERP", system: "ERP", prefix: "/api/finance", port: 4108, critical: true, owner: "erp-finance", tags: ["gl", "ar", "ap"] },
  { id: "manufacturing-mes", label: "Manufacturing MES", system: "ERP", prefix: "/api/mes", port: 4109, owner: "erp-manufacturing", tags: ["work-orders"] },
  { id: "hcm-erp", label: "HCM", system: "ERP", prefix: "/api/hcm", port: 4110, owner: "erp-people", tags: ["org", "employees"] },
  { id: "quality-qms", label: "Quality QMS", system: "ERP", prefix: "/api/quality", port: 4111, owner: "erp-quality", tags: ["ncr", "capa"] },
  { id: "logistics-tms", label: "Logistics TMS", system: "ERP", prefix: "/api/logistics", port: 4112, owner: "erp-logistics", tags: ["shipments"] },
  { id: "srm-core", label: "SRM Core", system: "SRM", prefix: "/api/srm", port: 4113, planned: true, owner: "srm", tags: ["suppliers"] },
  { id: "procurement-srm", label: "Procurement", system: "SRM", prefix: "/api/procurement", port: 4114, planned: true, owner: "srm", tags: ["requisitions", "po"] },
  { id: "prm-core", label: "PRM Core", system: "PRM", prefix: "/api/prm", port: 4115, planned: true, owner: "prm", tags: ["partners"] },
  { id: "channel-prm", label: "Channel PRM", system: "PRM", prefix: "/api/channel", port: 4116, planned: true, owner: "prm", tags: ["deal-reg"] },
  { id: "integration-hub", label: "Integration Hub", system: "Platform", prefix: "/api/integration", port: 4117, planned: true, owner: "platform", tags: ["events", "outbox"] },
  { id: "reporting-bi", label: "Reporting BI", system: "Platform", prefix: "/api/reporting", port: 4118, planned: true, owner: "platform", tags: ["metrics"] },
  { id: "admin-console", label: "Admin Console", system: "Apps", prefix: "/api/admin", port: 4119, critical: true, owner: "platform", tags: ["tenants", "config"] },
];

export function buildServiceCatalog(options: CatalogOptions = {}): ServiceCatalog {
  const template = options.originTemplate ?? "http://127.0.0.1:{port}";
  const services = SEEDS.map((seed) =>
    defineService({
      id: seed.id,
      label: seed.label,
      system: seed.system,
      prefix: seed.prefix,
      baseUrl: template.replace("{port}", String(seed.port)),
      critical: seed.critical ?? false,
      planned: options.assumeDeployed ? false : seed.planned,
      owner: seed.owner,
      tags: seed.tags,
      readyPath: "/health",
      openapiPath: "/openapi.json",
    }),
  );
  return new ServiceCatalog(services);
}

export const SERVICE_SEEDS = SEEDS;

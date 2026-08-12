import { GatewayService, type GatewayOptions } from "../application/gateway-service.js";
import { HealthService, type HealthOptions } from "../application/health-service.js";
import { OpenApiAggregator, type AggregatorOptions } from "../application/openapi-aggregator.js";
import type {
  Clock,
  Logger,
  MetricsSink,
  RateLimitStore,
  SpecSource,
  UpstreamProbe,
} from "../application/ports.js";
import { DEFAULT_ROLE_GRANTS, StaticPermissionResolver } from "../domain/policy.js";
import { RouteTable } from "../domain/route-table.js";
import type { ServiceCatalog } from "../domain/service-catalog.js";
import { buildServiceCatalog, type CatalogOptions } from "./catalog.js";
import { SystemClock } from "./clock.js";
import { ConsoleLogger, InMemoryMetrics } from "./logger.js";
import { HttpUpstreamProbe } from "./http-probe.js";
import { InMemoryRateLimitStore } from "./rate-limit-store.js";
import { buildRouteTable } from "./routes.js";
import { HttpSpecSource } from "./spec-source.js";

/** Composition root for the gateway process (and for tests, via overrides). */
export interface GatewayContainer {
  readonly catalog: ServiceCatalog;
  readonly routes: RouteTable;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly metrics: MetricsSink & { snapshot?: () => unknown };
  readonly rateLimits: RateLimitStore;
  readonly permissions: StaticPermissionResolver;
  readonly gateway: GatewayService;
  readonly health: HealthService;
  readonly openapi: OpenApiAggregator;
}

export interface ContainerOverrides {
  readonly catalog?: ServiceCatalog;
  readonly routes?: RouteTable;
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly metrics?: MetricsSink & { snapshot?: () => unknown };
  readonly rateLimits?: RateLimitStore;
  readonly probe?: UpstreamProbe;
  readonly specSource?: SpecSource;
  readonly roleGrants?: Readonly<Record<string, readonly string[]>>;
  readonly gateway?: GatewayOptions;
  readonly health?: HealthOptions;
  readonly openapi?: AggregatorOptions;
  readonly catalogOptions?: CatalogOptions;
}

export function createGatewayContainer(overrides: ContainerOverrides = {}): GatewayContainer {
  const clock = overrides.clock ?? new SystemClock();
  const logger = overrides.logger ?? new ConsoleLogger("info");
  const metrics = overrides.metrics ?? new InMemoryMetrics();
  const catalog = overrides.catalog ?? buildServiceCatalog(overrides.catalogOptions);
  const routes = overrides.routes ?? buildRouteTable(catalog);
  const rateLimits = overrides.rateLimits ?? new InMemoryRateLimitStore();
  const permissions = new StaticPermissionResolver(overrides.roleGrants ?? DEFAULT_ROLE_GRANTS);
  const probe = overrides.probe ?? new HttpUpstreamProbe(clock);
  const specSource = overrides.specSource ?? new HttpSpecSource();

  const gateway = new GatewayService(routes, catalog, rateLimits, clock, {
    defaultTimeoutMs: 10_000,
    permissions,
    ...overrides.gateway,
  });
  const health = new HealthService(catalog, probe, clock, logger, overrides.health);
  const openapi = new OpenApiAggregator(catalog, routes, specSource, clock, logger, {
    stubMissing: true,
    ...overrides.openapi,
  });

  return {
    catalog,
    routes,
    clock,
    logger,
    metrics,
    rateLimits,
    permissions,
    gateway,
    health,
    openapi,
  };
}

import {
  mergeOpenApiDocuments,
  synthesizeSpecFromRoutes,
  type MergeInput,
  type MergeReport,
  type OpenApiDocument,
  type OpenApiInfo,
  type OpenApiServer,
} from "../domain/openapi.js";
import type { RouteTable } from "../domain/route-table.js";
import type { ServiceCatalog, UpstreamService } from "../domain/service-catalog.js";
import type { Clock, Logger, SpecSource } from "./ports.js";

/**
 * Aggregates upstream OpenAPI documents into one gateway document.
 *
 * Two behaviours matter in a half-built suite like this one:
 *   1. A service that cannot serve its spec must not break the whole document.
 *      Its failure is recorded and, when `stubMissing` is on, replaced by a
 *      document synthesized from the route table.
 *   2. Aggregation is cached with a TTL because merging tens of documents on
 *      every docs page load is wasteful.
 */

export interface AggregatorOptions {
  readonly info?: OpenApiInfo;
  readonly servers?: readonly OpenApiServer[];
  readonly cacheTtlMs?: number;
  readonly fetchTimeoutMs?: number;
  /** Synthesize a placeholder document for upstreams without a spec. */
  readonly stubMissing?: boolean;
  readonly namespaceTags?: boolean;
  readonly namespaceOperationIds?: boolean;
}

export interface SourceOutcome {
  readonly serviceId: string;
  readonly source: "upstream" | "stub" | "failed" | "skipped";
  readonly pathCount: number;
  readonly durationMs: number;
  readonly error?: string;
}

export interface AggregationResult {
  readonly document: OpenApiDocument;
  readonly report: MergeReport & {
    readonly generatedAt: string;
    readonly cached: boolean;
    readonly sources: readonly SourceOutcome[];
  };
}

const DEFAULT_INFO: OpenApiInfo = {
  title: "Enterprise Suite API",
  version: "0.1.0",
  description:
    "Aggregated surface of every ERP / SRM / PRM domain service behind the enterprise gateway.",
};

export class OpenApiAggregator {
  private cached?: { result: AggregationResult; expiresAtMs: number };

  constructor(
    private readonly catalog: ServiceCatalog,
    private readonly routes: RouteTable,
    private readonly specSource: SpecSource,
    private readonly clock: Clock,
    private readonly logger?: Logger,
    private readonly options: AggregatorOptions = {},
  ) {}

  async aggregate(options: { force?: boolean } = {}): Promise<AggregationResult> {
    const ttl = this.options.cacheTtlMs ?? 30_000;
    const nowMs = this.clock.nowMs();
    if (!options.force && this.cached && this.cached.expiresAtMs > nowMs) {
      return { ...this.cached.result, report: { ...this.cached.result.report, cached: true } };
    }

    const routesByUpstream = this.routes.byUpstream();
    const outcomes: SourceOutcome[] = [];
    const inputs: MergeInput[] = [];

    const loaded = await Promise.all(
      this.catalog.list().map((service) => this.loadOne(service, routesByUpstream)),
    );
    for (const entry of loaded) {
      outcomes.push(entry.outcome);
      if (entry.input) inputs.push(entry.input);
    }

    const merged = mergeOpenApiDocuments(inputs, {
      info: this.options.info ?? DEFAULT_INFO,
      servers: this.options.servers,
      namespaceTags: this.options.namespaceTags ?? true,
      namespaceOperationIds: this.options.namespaceOperationIds ?? true,
      securitySchemes: {
        TenantHeader: {
          type: "apiKey",
          in: "header",
          name: "x-tenant-id",
          description: "Tenant scoping header enforced by the gateway.",
        },
        UserHeader: {
          type: "apiKey",
          in: "header",
          name: "x-user-id",
          description: "Acting principal header enforced by the gateway.",
        },
      },
    });

    const result: AggregationResult = {
      document: {
        ...merged.document,
        security: [{ TenantHeader: [], UserHeader: [] }],
      },
      report: {
        ...merged.report,
        generatedAt: this.clock.now(),
        cached: false,
        sources: outcomes,
      },
    };

    this.cached = { result, expiresAtMs: this.clock.nowMs() + ttl };
    if (merged.report.warnings.length > 0) {
      this.logger?.log("warn", "openapi aggregation produced warnings", {
        warnings: merged.report.warnings,
      });
    }
    return result;
  }

  invalidate(): void {
    this.cached = undefined;
  }

  private async loadOne(
    service: UpstreamService,
    routesByUpstream: ReadonlyMap<string, ReturnType<RouteTable["list"]>>,
  ): Promise<{ outcome: SourceOutcome; input?: MergeInput }> {
    const startedMs = this.clock.nowMs();
    const routes = routesByUpstream.get(service.id) ?? [];
    const stub = (): { outcome: SourceOutcome; input?: MergeInput } => {
      if (this.options.stubMissing === false || routes.length === 0) {
        return {
          outcome: {
            serviceId: service.id,
            source: "skipped",
            pathCount: 0,
            durationMs: this.clock.nowMs() - startedMs,
            error: routes.length === 0 ? "no routes and no upstream document" : undefined,
          },
        };
      }
      const document = synthesizeSpecFromRoutes(service, routes);
      return {
        outcome: {
          serviceId: service.id,
          source: "stub",
          pathCount: Object.keys(document.paths).length,
          durationMs: this.clock.nowMs() - startedMs,
        },
        input: { serviceId: service.id, document, prefix: service.prefix },
      };
    };

    if (service.planned) return stub();

    try {
      const document = await this.specSource.fetchSpec(
        service,
        this.options.fetchTimeoutMs ?? 3_000,
      );
      if (!document) return stub();
      return {
        outcome: {
          serviceId: service.id,
          source: "upstream",
          pathCount: Object.keys(document.paths ?? {}).length,
          durationMs: this.clock.nowMs() - startedMs,
        },
        input: { serviceId: service.id, document, prefix: service.prefix },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.log("warn", `openapi fetch failed for ${service.id}`, { error: message });
      const fallback = stub();
      if (fallback.input) {
        return {
          outcome: { ...fallback.outcome, source: "stub", error: message },
          input: fallback.input,
        };
      }
      return {
        outcome: {
          serviceId: service.id,
          source: "failed",
          pathCount: 0,
          durationMs: this.clock.nowMs() - startedMs,
          error: message,
        },
      };
    }
  }
}

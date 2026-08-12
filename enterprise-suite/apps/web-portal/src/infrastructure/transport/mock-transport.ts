import { newId, normalizePage, paginate } from "@enterprise-suite/shared-kernel";
import type { EndpointConfig } from "../../api/index.js";
import type { SearchHit } from "../../api/module-api.js";
import { ApiError, type ApiRequest, type ApiResponse, type RowLike, type Transport } from "../../api/types.js";
import { MODULE_KEYS, type ModuleKey } from "../../domain/module.js";
import type { Clock } from "../clock.js";
import {
  buildDataset,
  tenantDatasetOptions,
  type Dataset,
  type ModuleFixture,
  type ResourceFixture,
} from "../fixtures/index.js";

/**
 * In-memory stand-in for the six upstream services.
 *
 * It speaks the same HTTP surface the real ones do — tenant header required,
 * paginated lists, `?q=` search, domain-error envelopes — so the portal can be
 * demoed and tested end to end before any service is running. Failures can be
 * injected per module to exercise the shell's degraded rendering.
 */

export interface InjectedFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** Fail only the first N calls, then recover; omit for permanent failure. */
  readonly times?: number;
}

export interface MockTransportOptions {
  readonly endpoints: Readonly<Record<ModuleKey, EndpointConfig>>;
  readonly clock: Clock;
  readonly latencyMs?: number;
}

const RESERVED_QUERY_KEYS = new Set(["page", "pageSize", "q", "sort", "limit"]);

export class MockTransport implements Transport {
  private readonly bases: ReadonlyArray<{ module: ModuleKey; base: string }>;
  private readonly clock: Clock;
  private readonly latencyMs: number;
  private readonly datasets = new Map<string, Dataset>();
  private readonly failures = new Map<ModuleKey, { failure: InjectedFailure; used: number }>();
  readonly calls: Array<{ module: ModuleKey; method: string; path: string; tenantId: string }> = [];

  constructor(options: MockTransportOptions) {
    this.bases = MODULE_KEYS.map((module) => ({
      module,
      base: options.endpoints[module].baseUrl.replace(/\/+$/, ""),
    })).sort((a, b) => b.base.length - a.base.length);
    this.clock = options.clock;
    this.latencyMs = options.latencyMs ?? 0;
  }

  /** Make a module fail, to demo/verify degraded dashboard tiles. */
  failModule(module: ModuleKey, failure: InjectedFailure): void {
    this.failures.set(module, { failure, used: 0 });
  }

  clearFailures(): void {
    this.failures.clear();
  }

  async send(request: ApiRequest): Promise<ApiResponse> {
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));

    const target = this.bases.find((entry) => request.url.startsWith(entry.base));
    if (!target) {
      throw new ApiError(
        `No mock service mounted at ${request.url}`,
        "network",
        0,
        request.url,
        request.requestId,
      );
    }

    const url = new URL(request.url);
    const base = new URL(target.base);
    const path = url.pathname.slice(base.pathname.length) || "/";
    const tenantId = request.headers["x-tenant-id"];
    this.calls.push({ module: target.module, method: request.method, path, tenantId: tenantId ?? "" });

    const injected = this.takeFailure(target.module);
    if (injected) {
      return {
        status: injected.status,
        headers: {},
        body: { code: injected.code, message: injected.message },
      };
    }

    if (!tenantId) {
      return errorResponse(400, "TENANT_REQUIRED", "x-tenant-id header is required");
    }
    if (!request.headers.authorization && !request.headers["x-user-id"]) {
      return errorResponse(401, "UNAUTHENTICATED", "Missing bearer token or x-user-id");
    }

    const dataset = this.datasetFor(tenantId);
    const fixture = dataset[target.module];

    if (request.method !== "GET") {
      return this.handleWrite(fixture, path, request);
    }
    if (path === "/summary") {
      return okResponse(fixture.summary);
    }
    if (path === "/search") {
      return okResponse(searchFixture(fixture, url.searchParams));
    }

    const [, slug, id] = path.split("/");
    const resource = fixture.resources.find((r) => r.slug === slug);
    if (!resource) {
      return errorResponse(404, "ROUTE_NOT_FOUND", `${request.method} ${path}`);
    }
    if (id) {
      const row = resource.rows.find((r) => r.id === id);
      return row
        ? okResponse(row)
        : errorResponse(404, "NOT_FOUND", `${slug} not found: ${id}`);
    }
    return okResponse(listResource(resource, url.searchParams));
  }

  private handleWrite(
    fixture: ModuleFixture,
    path: string,
    request: ApiRequest,
  ): ApiResponse {
    const [, slug] = path.split("/");
    const resource = fixture.resources.find((r) => r.slug === slug);
    if (!resource) {
      return errorResponse(404, "ROUTE_NOT_FOUND", `${request.method} ${path}`);
    }
    // Writes are acknowledged, not applied: the portal only needs to prove it
    // forwards a well-formed command with the session's headers attached.
    return {
      status: 202,
      headers: {},
      body: {
        id: newId(slug.slice(0, 3)),
        accepted: true,
        module: fixture.module,
        command: `${request.method} ${path}`,
        acceptedAt: this.clock.now(),
        echo: request.body ?? null,
      },
    };
  }

  private takeFailure(module: ModuleKey): InjectedFailure | undefined {
    const entry = this.failures.get(module);
    if (!entry) return undefined;
    if (entry.failure.times !== undefined && entry.used >= entry.failure.times) return undefined;
    entry.used += 1;
    return entry.failure;
  }

  private datasetFor(tenantId: string): Dataset {
    const cached = this.datasets.get(tenantId);
    if (cached) return cached;
    const options = tenantDatasetOptions(tenantId) ?? { currency: "USD", prefix: tenantId.slice(0, 3).toUpperCase() };
    const dataset = buildDataset({
      tenantId,
      currency: options.currency,
      prefix: options.prefix,
      now: this.clock.now(),
    });
    this.datasets.set(tenantId, dataset);
    return dataset;
  }
}

function listResource(resource: ResourceFixture, params: URLSearchParams) {
  let rows: readonly RowLike[] = resource.rows;

  const term = params.get("q")?.trim().toLowerCase();
  if (term) {
    rows = rows.filter((row) =>
      resource.searchable.some((field) => String(row[field] ?? "").toLowerCase().includes(term)),
    );
  }

  for (const [key, value] of params.entries()) {
    if (RESERVED_QUERY_KEYS.has(key)) continue;
    rows = rows.filter((row) => String(row[key] ?? "") === value);
  }

  const sort = params.get("sort");
  if (sort) {
    const desc = sort.startsWith("-");
    const field = desc ? sort.slice(1) : sort;
    rows = [...rows].sort((a, b) => {
      const left = String(a[field] ?? "");
      const right = String(b[field] ?? "");
      return desc ? right.localeCompare(left) : left.localeCompare(right);
    });
  }

  return paginate(
    rows,
    normalizePage({
      page: intParam(params.get("page")),
      pageSize: intParam(params.get("pageSize")),
    }),
  );
}

function searchFixture(fixture: ModuleFixture, params: URLSearchParams): readonly SearchHit[] {
  const term = params.get("q")?.trim().toLowerCase() ?? "";
  const limit = intParam(params.get("limit")) ?? 5;
  if (term.length === 0) return [];

  const hits: SearchHit[] = [];
  for (const resource of fixture.resources) {
    for (const row of resource.rows) {
      const matches = resource.searchable.some((field) =>
        String(row[field] ?? "").toLowerCase().includes(term),
      );
      if (!matches) continue;
      hits.push({
        module: fixture.module,
        id: row.id,
        title: resource.title(row),
        subtitle: resource.subtitle(row),
        path: `/m/${fixture.module}/${resource.slug}?q=${encodeURIComponent(term)}`,
      });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

function intParam(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function okResponse(body: unknown): ApiResponse {
  return { status: 200, headers: { "content-type": "application/json" }, body };
}

function errorResponse(status: number, code: string, message: string): ApiResponse {
  return { status, headers: { "content-type": "application/json" }, body: { code, message } };
}

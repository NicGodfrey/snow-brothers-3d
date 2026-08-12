/**
 * Outbox relay core: polls the domain services' outbox endpoints and forwards
 * every event to integration-hub, so events actually leave their process.
 *
 * Per service the relay
 *   1. discovers which endpoint the service exposes (probing, in order,
 *      `POST /outbox/drain`, then the peek paths `GET /outbox/pending`,
 *      `GET /outbox`, `GET /sales/outbox`, `GET /events`);
 *   2. collects the new events (drain endpoints hand them over exactly once;
 *      peek endpoints are deduplicated client-side by eventId);
 *   3. posts them to the hub's bulk-ingestion endpoint `POST /outbox/batch`
 *      in one batch per tenant (the hub authenticates per tenant).
 *
 * Idempotency: producer eventIds are preserved end to end and the hub
 * deduplicates on (tenant, source, eventId), so a crash between drain and
 * acknowledgement, a retry, or a peek re-read can never double-publish.
 * Drained-but-unacknowledged events are additionally kept in a local retry
 * buffer so a hub outage does not lose them.
 */

export interface RelayTarget {
  /** Manifest service id; also used as the hub's `source` field. */
  readonly id: string;
  readonly baseUrl: string;
}

export interface RelayEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly [key: string]: unknown;
}

type Mode =
  | { kind: "drain"; path: string }
  | { kind: "peek"; path: string }
  | { kind: "unknown" }
  | { kind: "unsupported" };

export interface ServiceState {
  readonly id: string;
  readonly baseUrl: string;
  mode: Mode;
  /** eventIds already forwarded (peek mode dedupe). */
  readonly seen: Set<string>;
  /** Drained events the hub has not acknowledged yet. */
  buffer: RelayEvent[];
  relayed: number;
  duplicates: number;
  lastError?: string;
  lastPolledAt?: string;
}

export interface RelayOptions {
  readonly hubUrl: string;
  readonly targets: readonly RelayTarget[];
  /** Headers the relay authenticates with against the services and the hub. */
  readonly userId?: string;
  readonly roles?: string;
  /** Tenant header used when polling (drain endpoints ignore it). */
  readonly pollTenantId?: string;
  readonly fetchImpl?: typeof fetch;
  readonly requestTimeoutMs?: number;
  readonly maxBatchSize?: number;
  readonly log?: (message: string) => void;
}

export const DRAIN_PATH = "/outbox/drain";
export const PEEK_PATHS = ["/outbox/pending", "/outbox", "/sales/outbox", "/events"] as const;
export const HUB_BATCH_PATH = "/outbox/batch";

/**
 * Accepts every response shape the suite's services use:
 * `{ items }`, `{ count, items }`, `{ drained, items }`, `{ data: {...} }`
 * (manufacturing-mes wraps bodies), a raw array (`/events`), `{ events }`
 * (sales-erp debug view) and records that nest the envelope under
 * `envelope`/`event` (logistics-tms outbox records).
 */
export function normalizeEvents(body: unknown): RelayEvent[] {
  let value = body;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (obj["data"] !== undefined) value = obj["data"];
  }
  let list: unknown[];
  if (Array.isArray(value)) {
    list = value;
  } else if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const items = obj["items"] ?? obj["events"];
    if (!Array.isArray(items)) return [];
    list = items;
  } else {
    return [];
  }

  const events: RelayEvent[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    let candidate = entry as Record<string, unknown>;
    const nested = candidate["envelope"] ?? candidate["event"];
    if (
      typeof candidate["eventId"] !== "string" &&
      nested &&
      typeof nested === "object"
    ) {
      candidate = nested as Record<string, unknown>;
    }
    if (
      typeof candidate["eventId"] === "string" &&
      typeof candidate["eventType"] === "string" &&
      typeof candidate["tenantId"] === "string"
    ) {
      events.push(candidate as unknown as RelayEvent);
    }
  }
  return events;
}

export function groupByTenant(events: readonly RelayEvent[]): Map<string, RelayEvent[]> {
  const groups = new Map<string, RelayEvent[]>();
  for (const event of events) {
    const bucket = groups.get(event.tenantId) ?? [];
    bucket.push(event);
    groups.set(event.tenantId, bucket);
  }
  return groups;
}

export interface ServiceCycleSummary {
  readonly id: string;
  readonly mode: string;
  readonly fetched: number;
  readonly forwarded: number;
  readonly duplicates: number;
  readonly buffered: number;
  readonly error?: string;
}

export interface CycleSummary {
  readonly startedAt: string;
  readonly services: ServiceCycleSummary[];
  readonly forwarded: number;
}

export class OutboxRelay {
  readonly states: ServiceState[];
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBatchSize: number;
  private readonly log: (message: string) => void;
  private cycles = 0;
  private lastCycle?: CycleSummary;

  constructor(private readonly options: RelayOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.requestTimeoutMs ?? 3_000;
    this.maxBatchSize = options.maxBatchSize ?? 200;
    this.log = options.log ?? (() => {});
    this.states = options.targets.map((target) => ({
      id: target.id,
      baseUrl: target.baseUrl.replace(/\/+$/, ""),
      mode: { kind: "unknown" },
      seen: new Set<string>(),
      buffer: [],
      relayed: 0,
      duplicates: 0,
    }));
  }

  private headers(tenantId: string): Record<string, string> {
    return {
      "content-type": "application/json",
      "x-tenant-id": tenantId,
      "x-user-id": this.options.userId ?? "outbox-relay",
      "x-roles": this.options.roles ?? "integration",
    };
  }

  private async request(
    url: string,
    init: { method: string; tenantId: string; body?: unknown },
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: init.method,
        headers: this.headers(init.tenantId),
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
      });
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = undefined;
      }
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  }

  /** Finds the outbox endpoint a service actually exposes. */
  private async discover(state: ServiceState): Promise<Mode> {
    const tenant = this.options.pollTenantId ?? "system";
    // Peek first so discovery never consumes events it might then drop.
    for (const path of PEEK_PATHS) {
      try {
        const res = await this.request(`${state.baseUrl}${path}`, { method: "GET", tenantId: tenant });
        if (res.status >= 200 && res.status < 300) {
          // A service with a working peek path almost always pairs it with a
          // drain; verify by draining (the result is forwarded, never lost).
          const drain = await this.request(`${state.baseUrl}${DRAIN_PATH}`, {
            method: "POST",
            tenantId: tenant,
          });
          if (drain.status >= 200 && drain.status < 300) {
            state.buffer.push(...normalizeEvents(drain.body));
            return { kind: "drain", path: DRAIN_PATH };
          }
          return { kind: "peek", path };
        }
      } catch {
        return { kind: "unknown" }; // service down — retry discovery next cycle
      }
    }
    try {
      const drain = await this.request(`${state.baseUrl}${DRAIN_PATH}`, {
        method: "POST",
        tenantId: tenant,
      });
      if (drain.status >= 200 && drain.status < 300) {
        state.buffer.push(...normalizeEvents(drain.body));
        return { kind: "drain", path: DRAIN_PATH };
      }
    } catch {
      return { kind: "unknown" };
    }
    return { kind: "unsupported" };
  }

  /** Collects new events from one service into its unacknowledged buffer. */
  private async collect(state: ServiceState): Promise<number> {
    const tenant = this.options.pollTenantId ?? "system";
    if (state.mode.kind === "unknown") {
      state.mode = await this.discover(state);
      if (state.mode.kind === "drain") return state.buffer.length;
    }
    if (state.mode.kind === "unsupported" || state.mode.kind === "unknown") return 0;

    if (state.mode.kind === "drain") {
      const res = await this.request(`${state.baseUrl}${state.mode.path}`, {
        method: "POST",
        tenantId: tenant,
      });
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`drain returned HTTP ${res.status}`);
      }
      const events = normalizeEvents(res.body);
      state.buffer.push(...events);
      return events.length;
    }

    const res = await this.request(`${state.baseUrl}${state.mode.path}`, {
      method: "GET",
      tenantId: tenant,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`peek returned HTTP ${res.status}`);
    }
    const fresh = normalizeEvents(res.body).filter(
      (event) => !state.seen.has(event.eventId) && !state.buffer.some((b) => b.eventId === event.eventId),
    );
    state.buffer.push(...fresh);
    return fresh.length;
  }

  /** Posts the buffered events to the hub, one batch per tenant. */
  private async forward(state: ServiceState): Promise<{ forwarded: number; duplicates: number }> {
    let forwarded = 0;
    let duplicates = 0;
    while (state.buffer.length > 0) {
      const chunk = state.buffer.slice(0, this.maxBatchSize);
      for (const [tenantId, events] of groupByTenant(chunk)) {
        const res = await this.request(`${this.options.hubUrl.replace(/\/+$/, "")}${HUB_BATCH_PATH}`, {
          method: "POST",
          tenantId,
          body: { source: state.id, events },
        });
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`hub returned HTTP ${res.status}`);
        }
        const body = (res.body ?? {}) as { enqueued?: number; duplicates?: number };
        forwarded += body.enqueued ?? events.length;
        duplicates += body.duplicates ?? 0;
        for (const event of events) state.seen.add(event.eventId);
      }
      state.buffer = state.buffer.slice(chunk.length);
    }
    return { forwarded, duplicates };
  }

  /** One poll cycle over every service. Never throws; failures are per service. */
  async runOnce(): Promise<CycleSummary> {
    const services: ServiceCycleSummary[] = [];
    let totalForwarded = 0;
    const startedAt = new Date().toISOString();

    for (const state of this.states) {
      let fetched = 0;
      let forwarded = 0;
      let duplicates = 0;
      state.lastPolledAt = new Date().toISOString();
      try {
        fetched = await this.collect(state);
        const result = await this.forward(state);
        forwarded = result.forwarded;
        duplicates = result.duplicates;
        state.relayed += forwarded;
        state.duplicates += duplicates;
        state.lastError = undefined;
        if (forwarded > 0) {
          this.log(`${state.id}: forwarded ${forwarded} event(s) (${duplicates} duplicate(s))`);
        }
      } catch (error) {
        state.lastError = error instanceof Error ? error.message : String(error);
        // Re-discover next cycle in case the service restarted on a new shape.
        if (state.mode.kind !== "drain" && state.mode.kind !== "peek") {
          state.mode = { kind: "unknown" };
        }
      }
      totalForwarded += forwarded;
      services.push({
        id: state.id,
        mode: describeMode(state.mode),
        fetched,
        forwarded,
        duplicates,
        buffered: state.buffer.length,
        error: state.lastError,
      });
    }

    this.cycles += 1;
    this.lastCycle = { startedAt, services, forwarded: totalForwarded };
    return this.lastCycle;
  }

  status(): {
    cycles: number;
    hubUrl: string;
    services: Array<{
      id: string;
      baseUrl: string;
      mode: string;
      relayed: number;
      duplicates: number;
      buffered: number;
      lastError?: string;
      lastPolledAt?: string;
    }>;
    lastCycle?: CycleSummary;
  } {
    return {
      cycles: this.cycles,
      hubUrl: this.options.hubUrl,
      services: this.states.map((state) => ({
        id: state.id,
        baseUrl: state.baseUrl,
        mode: describeMode(state.mode),
        relayed: state.relayed,
        duplicates: state.duplicates,
        buffered: state.buffer.length,
        lastError: state.lastError,
        lastPolledAt: state.lastPolledAt,
      })),
      lastCycle: this.lastCycle,
    };
  }
}

function describeMode(mode: Mode): string {
  switch (mode.kind) {
    case "drain":
      return `drain ${mode.path}`;
    case "peek":
      return `peek ${mode.path}`;
    default:
      return mode.kind;
  }
}

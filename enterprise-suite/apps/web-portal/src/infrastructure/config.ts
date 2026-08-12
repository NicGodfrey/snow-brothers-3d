import { MODULE_KEYS, type ModuleKey } from "../domain/module.js";
import type { EndpointConfig } from "../api/index.js";

/**
 * Portal configuration.
 *
 * Service endpoints default to the api-gateway prefixes (`/api/<module>`) so a
 * single `PORTAL_GATEWAY_URL` is enough in a normal deployment; each module can
 * still be pointed at a directly-addressed service for local work.
 */

export type TransportMode = "mock" | "http";

export interface PortalConfig {
  readonly port: number;
  readonly transport: TransportMode;
  readonly gatewayUrl: string;
  readonly endpoints: Readonly<Record<ModuleKey, EndpointConfig>>;
  readonly sessionTtlMinutes: number;
  readonly suiteAuthSecret: string;
  readonly trustHeaders: boolean;
  readonly defaultTenantId: string;
  readonly requestTimeoutMs: number;
  /** Milliseconds the mock transport waits before answering, to exercise loading paths. */
  readonly mockLatencyMs: number;
}

export const LOCAL_DEMO_SUITE_AUTH_SECRET = "local-demo-only-suite-auth-secret";

const GATEWAY_PREFIX: Readonly<Record<ModuleKey, string>> = {
  sales: "/api/sales",
  marketing: "/api/marketing",
  inventory: "/api/inventory",
  srm: "/api/srm",
  prm: "/api/prm",
  finance: "/api/finance",
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): PortalConfig {
  const gatewayUrl = (env.PORTAL_GATEWAY_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
  const timeoutMs = intFromEnv(env.PORTAL_REQUEST_TIMEOUT_MS, 5_000);
  const endpoints = Object.fromEntries(
    MODULE_KEYS.map((key) => [
      key,
      {
        baseUrl: env[`PORTAL_${key.toUpperCase()}_URL`] ?? `${gatewayUrl}${GATEWAY_PREFIX[key]}`,
        timeoutMs,
        retries: intFromEnv(env.PORTAL_RETRIES, 2),
      } satisfies EndpointConfig,
    ]),
  ) as Record<ModuleKey, EndpointConfig>;

  return {
    port: intFromEnv(env.PORT, 4300),
    transport: env.PORTAL_TRANSPORT === "http" ? "http" : "mock",
    gatewayUrl,
    endpoints,
    sessionTtlMinutes: intFromEnv(env.PORTAL_SESSION_TTL_MINUTES, 480),
    suiteAuthSecret: env.SUITE_AUTH_SECRET ?? LOCAL_DEMO_SUITE_AUTH_SECRET,
    trustHeaders: env.SUITE_TRUST_HEADERS === "true",
    defaultTenantId: env.PORTAL_DEFAULT_TENANT ?? "acme",
    requestTimeoutMs: timeoutMs,
    mockLatencyMs: intFromEnv(env.PORTAL_MOCK_LATENCY_MS, 0),
  };
}

function intFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

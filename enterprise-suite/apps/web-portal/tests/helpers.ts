import { createContainer, type PortalContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { loadConfig, type PortalConfig } from "../src/infrastructure/config.js";
import { MockTransport } from "../src/infrastructure/transport/mock-transport.js";
import type { PortalSession } from "../src/domain/session.js";

export const NOW = "2026-03-02T09:00:00.000Z";

export interface TestHarness {
  readonly container: PortalContainer;
  readonly transport: MockTransport;
  readonly clock: FixedClock;
  readonly config: PortalConfig;
  session(email: string, tenantId?: string): PortalSession;
}

/** Container wired to a pinned clock and an inspectable mock transport. */
export function createHarness(): TestHarness {
  const clock = new FixedClock(NOW);
  const config: PortalConfig = {
    ...loadConfig({}),
    transport: "mock",
    sessionSecret: "test-secret",
    mockLatencyMs: 0,
  };
  const transport = new MockTransport({ endpoints: config.endpoints, clock });
  const container = createContainer({ config, clock, transport });
  return {
    container,
    transport,
    clock,
    config,
    session: (email: string, tenantId?: string) =>
      container.auth.signIn({ email, tenantId }).session,
  };
}

export const USERS = {
  salesManager: "avery.chen@acme.test",
  buyer: "jordan.blake@acme.test",
  controller: "rin.watanabe@acme.test",
  marketer: "sam.okafor@acme.test",
  admin: "dana.reyes@acme.test",
} as const;

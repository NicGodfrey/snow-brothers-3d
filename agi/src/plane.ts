import { loadConfig, type AgiConfig } from "./config.ts";
import { OfficialCursorClient } from "./cursor/client.ts";
import { MockCursorClient } from "./cursor/mock.ts";
import type { CursorTransport } from "./cursor/types.ts";
import { loadLucyCopies } from "./lucy/copies.ts";
import { LucyGateway } from "./lucy/gateway.ts";
import { LucyPool } from "./lucy/pool.ts";
import { FleetRegistry } from "./registry.ts";
import { Scheduler } from "./scheduler.ts";

export interface ControlPlane {
  config: AgiConfig;
  registry: FleetRegistry;
  transport: CursorTransport;
  scheduler: Scheduler;
  lucy: LucyGateway;
}

export function createPlane(overrides: Partial<AgiConfig> = {}): ControlPlane {
  const config = loadConfig(overrides);
  const registry = config.fleetPath
    ? FleetRegistry.fromFile(config.fleetPath)
    : new FleetRegistry();
  const transport =
    config.transport === "official"
      ? new OfficialCursorClient(config)
      : new MockCursorClient(
          registry.slots
            .map((s) => s.agentId)
            .filter((id): id is string => Boolean(id)),
        );
  const lucy = new LucyGateway(
    new LucyPool(loadLucyCopies(config.lucyCopiesPath), registry),
    config,
    transport,
  );
  return {
    config,
    registry,
    transport,
    scheduler: new Scheduler(registry, transport, config),
    lucy,
  };
}

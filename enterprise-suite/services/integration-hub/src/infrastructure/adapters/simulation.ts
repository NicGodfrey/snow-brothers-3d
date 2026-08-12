/**
 * Shared scaffolding for the stub drivers.
 *
 * The drivers are stubs in the sense that they do not open a socket: each one
 * keeps an in-memory representation of the remote system (a directory, a
 * bucket, a topic log) so the registry, config validation, health tracking,
 * routing and inbox ingestion can all be exercised end to end. They are also
 * the seam where a real client library gets dropped in later — the driver
 * interface would not change.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { HealthCheckResult } from "../../domain/adapter.js";

export interface SimulationControls {
  /** Fail the next N operations (health checks and sends). */
  failNext: number;
  /** Permanent failure switch, e.g. "credentials revoked". */
  unhealthy: boolean;
  /** Reported latency in ms. */
  latencyMs: number;
  /** Message keys that the remote system rejects. */
  rejectKeys: Set<string>;
}

export function newSimulation(overrides: Partial<SimulationControls> = {}): SimulationControls {
  return {
    failNext: 0,
    unhealthy: false,
    latencyMs: 12,
    rejectKeys: new Set(),
    ...overrides,
  };
}

export class AdapterUnavailableError extends Error {
  constructor(kind: string, reason: string) {
    super(`${kind} adapter unavailable: ${reason}`);
    this.name = "AdapterUnavailableError";
  }
}

/** Consumes one scripted failure, if any. */
export function takeFailure(simulation: SimulationControls): string | undefined {
  if (simulation.unhealthy) return "endpoint marked unhealthy";
  if (simulation.failNext > 0) {
    simulation.failNext -= 1;
    return "simulated transient failure";
  }
  return undefined;
}

export function healthResult(
  simulation: SimulationControls,
  now: IsoDateTime,
  okMessage: string,
): HealthCheckResult {
  const failure = takeFailure(simulation);
  return {
    healthy: failure === undefined,
    latencyMs: simulation.latencyMs,
    message: failure ?? okMessage,
    checkedAt: now,
  };
}

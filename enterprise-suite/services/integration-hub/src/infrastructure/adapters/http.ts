/**
 * HTTP adapter: POSTs batches to a partner API endpoint.
 *
 * Unlike a webhook subscription (which the *tenant* owns and which carries a
 * signature), an HTTP adapter is an outbound integration the operator
 * configures against a fixed partner API, with its own auth scheme.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { AdapterDescriptor, HealthCheckResult } from "../../domain/adapter.js";
import type {
  AdapterDriver,
  AdapterMessage,
  AdapterPullResult,
  AdapterSendResult,
} from "../../application/ports.js";
import { healthResult, newSimulation, takeFailure, AdapterUnavailableError } from "./simulation.js";

export interface SentBatch {
  readonly endpoint: string;
  readonly messages: readonly AdapterMessage[];
  readonly reference: string;
}

export class HttpAdapterDriver implements AdapterDriver {
  readonly simulation = newSimulation();
  /** Everything this driver "sent", for assertions and the demo. */
  readonly batches: SentBatch[] = [];
  private sequence = 0;

  readonly descriptor: AdapterDescriptor = {
    kind: "http",
    displayName: "HTTP endpoint",
    direction: "outbound",
    capabilities: { supportsPush: true, supportsPull: false, supportsBatch: true, maxBatchSize: 500 },
    configSchema: [
      { name: "endpoint", type: "url", required: true, description: "Absolute URL of the partner API" },
      {
        name: "authScheme",
        type: "enum",
        required: true,
        values: ["none", "bearer", "basic", "api-key"],
        default: "bearer",
        description: "How the request is authenticated",
      },
      {
        name: "credentialsRef",
        type: "secret-ref",
        required: false,
        description: "secret:// reference resolved at send time",
      },
      { name: "timeoutMs", type: "number", required: false, default: 10_000, min: 100, max: 60_000 },
      { name: "batchSize", type: "number", required: false, default: 50, min: 1, max: 500 },
    ],
  };

  async test(config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult> {
    return healthResult(this.simulation, now, `endpoint ${String(config["endpoint"])} reachable`);
  }

  async send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("http", failure);

    const rejected = messages
      .filter((message) => this.simulation.rejectKeys.has(message.key))
      .map((message) => ({ key: message.key, reason: "rejected by partner API (422)" }));
    const accepted = messages.filter((message) => !this.simulation.rejectKeys.has(message.key));
    const reference = `http-${++this.sequence}`;
    this.batches.push({ endpoint: String(config["endpoint"]), messages: accepted, reference });

    return {
      accepted: accepted.length,
      rejected,
      reference,
      latencyMs: this.simulation.latencyMs,
    };
  }

  async pull(): Promise<AdapterPullResult> {
    throw new AdapterUnavailableError("http", "this driver is outbound-only");
  }
}

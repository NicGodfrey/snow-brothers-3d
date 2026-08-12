/**
 * Object-storage adapter: writes each batch as an object under a date-based
 * prefix, which is how data-lake style integrations usually consume events.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { AdapterDescriptor, HealthCheckResult } from "../../domain/adapter.js";
import type {
  AdapterDriver,
  AdapterMessage,
  AdapterPullResult,
  AdapterSendResult,
} from "../../application/ports.js";
import { AdapterUnavailableError, healthResult, newSimulation, takeFailure } from "./simulation.js";

export interface StoredObject {
  readonly key: string;
  readonly body: string;
  readonly contentType: string;
}

export class S3AdapterDriver implements AdapterDriver {
  readonly simulation = newSimulation({ latencyMs: 25 });
  readonly objects = new Map<string, StoredObject>();
  private sequence = 0;

  readonly descriptor: AdapterDescriptor = {
    kind: "s3",
    displayName: "Object storage bucket",
    direction: "outbound",
    capabilities: { supportsPush: true, supportsPull: false, supportsBatch: true, maxBatchSize: 5_000 },
    configSchema: [
      { name: "bucket", type: "string", required: true },
      { name: "region", type: "string", required: false, default: "eu-central-1" },
      { name: "prefix", type: "string", required: false, default: "events" },
      { name: "credentialsRef", type: "secret-ref", required: true },
      {
        name: "layout",
        type: "enum",
        required: false,
        values: ["batch-json", "one-object-per-message"],
        default: "batch-json",
      },
    ],
  };

  async test(config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult> {
    return healthResult(
      this.simulation,
      now,
      `bucket ${String(config["bucket"])} in ${String(config["region"] ?? "eu-central-1")} writable`,
    );
  }

  async send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("s3", failure);

    const prefix = String(config["prefix"] ?? "events");
    const layout = String(config["layout"] ?? "batch-json");
    const batch = ++this.sequence;

    if (layout === "batch-json") {
      const key = `${prefix}/batch-${String(batch).padStart(6, "0")}.json`;
      this.objects.set(key, {
        key,
        body: JSON.stringify(messages.map((message) => message.payload)),
        contentType: "application/json",
      });
    } else {
      for (const message of messages) {
        const key = `${prefix}/${message.eventType}/${message.key}.json`;
        this.objects.set(key, {
          key,
          body: JSON.stringify(message.payload),
          contentType: "application/json",
        });
      }
    }

    return {
      accepted: messages.length,
      rejected: [],
      reference: `s3://${String(config["bucket"])}/${prefix}`,
      latencyMs: this.simulation.latencyMs,
    };
  }

  async pull(): Promise<AdapterPullResult> {
    throw new AdapterUnavailableError("s3", "this driver is outbound-only");
  }
}

/**
 * SFTP adapter: the classic EDI drop-folder integration.
 *
 * Outbound messages are written as files into a simulated remote directory;
 * inbound pulls read whatever the partner left in the inbound directory and
 * mark those files consumed. File naming is deterministic so a re-run cannot
 * create duplicates with different names.
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

export interface RemoteFile {
  readonly path: string;
  readonly content: string;
  consumed: boolean;
}

export class SftpAdapterDriver implements AdapterDriver {
  readonly simulation = newSimulation({ latencyMs: 40 });
  /** Simulated remote filesystem, keyed by full path. */
  readonly files = new Map<string, RemoteFile>();

  readonly descriptor: AdapterDescriptor = {
    kind: "sftp",
    displayName: "SFTP drop folder",
    direction: "bidirectional",
    capabilities: { supportsPush: true, supportsPull: true, supportsBatch: true, maxBatchSize: 1_000 },
    configSchema: [
      { name: "host", type: "string", required: true },
      { name: "port", type: "number", required: false, default: 22, min: 1, max: 65_535 },
      { name: "username", type: "string", required: true },
      { name: "credentialsRef", type: "secret-ref", required: true, description: "SSH key or password" },
      { name: "outboundDir", type: "string", required: true, default: "/outbound" },
      { name: "inboundDir", type: "string", required: false, default: "/inbound" },
      {
        name: "format",
        type: "enum",
        required: false,
        values: ["json", "ndjson", "edifact"],
        default: "ndjson",
      },
    ],
  };

  /** Seeds a file as if the partner had uploaded it. */
  placeInboundFile(config: { inboundDir?: string }, name: string, content: string): void {
    const path = `${config.inboundDir ?? "/inbound"}/${name}`;
    this.files.set(path, { path, content, consumed: false });
  }

  async test(config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult> {
    return healthResult(
      this.simulation,
      now,
      `connected to ${String(config["username"])}@${String(config["host"])}:${String(config["port"] ?? 22)}`,
    );
  }

  async send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("sftp", failure);

    const dir = String(config["outboundDir"] ?? "/outbound");
    const format = String(config["format"] ?? "ndjson");
    const rejected: { key: string; reason: string }[] = [];
    let accepted = 0;

    if (format === "ndjson") {
      // One file per batch, one JSON document per line.
      const path = `${dir}/batch-${this.files.size + 1}.ndjson`;
      const content = messages.map((message) => JSON.stringify(message.payload)).join("\n");
      this.files.set(path, { path, content, consumed: false });
      accepted = messages.length;
    } else {
      for (const message of messages) {
        if (this.simulation.rejectKeys.has(message.key)) {
          rejected.push({ key: message.key, reason: "remote refused the write" });
          continue;
        }
        const path = `${dir}/${sanitize(message.key)}.${format === "edifact" ? "edi" : "json"}`;
        this.files.set(path, { path, content: JSON.stringify(message.payload), consumed: false });
        accepted++;
      }
    }

    return { accepted, rejected, reference: dir, latencyMs: this.simulation.latencyMs };
  }

  async pull(config: Readonly<Record<string, unknown>>): Promise<AdapterPullResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("sftp", failure);

    const dir = String(config["inboundDir"] ?? "/inbound");
    const pending = [...this.files.values()].filter(
      (file) => !file.consumed && file.path.startsWith(`${dir}/`),
    );
    const messages: AdapterMessage[] = pending.map((file) => {
      file.consumed = true;
      return {
        key: file.path,
        eventType: "integration.adapter.file-received",
        payload: parseMaybeJson(file.content),
        headers: { "x-source-path": file.path },
      };
    });
    return { messages, cursor: dir, latencyMs: this.simulation.latencyMs };
  }
}

function sanitize(key: string): string {
  return key.replace(/[^A-Za-z0-9._-]/g, "_");
}

function parseMaybeJson(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

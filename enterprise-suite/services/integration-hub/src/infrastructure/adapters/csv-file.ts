/**
 * CSV export adapter: flattens payloads into a delimited file using a
 * configured column list. Legacy finance and logistics systems still consume
 * exactly this.
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { AdapterDescriptor, HealthCheckResult } from "../../domain/adapter.js";
import type {
  AdapterDriver,
  AdapterMessage,
  AdapterPullResult,
  AdapterSendResult,
} from "../../application/ports.js";
import { getPath } from "../../domain/transform.js";
import { AdapterUnavailableError, healthResult, newSimulation, takeFailure } from "./simulation.js";

export interface CsvExport {
  readonly fileName: string;
  readonly content: string;
  readonly rows: number;
}

export class CsvFileAdapterDriver implements AdapterDriver {
  readonly simulation = newSimulation({ latencyMs: 5 });
  readonly exports: CsvExport[] = [];

  readonly descriptor: AdapterDescriptor = {
    kind: "csv-file",
    displayName: "CSV export",
    direction: "outbound",
    capabilities: { supportsPush: true, supportsPull: false, supportsBatch: true, maxBatchSize: 50_000 },
    configSchema: [
      {
        name: "columns",
        type: "string",
        required: true,
        description: "Comma-separated payload paths, e.g. 'orderId,total.amount'",
      },
      { name: "delimiter", type: "enum", required: false, values: [",", ";", "\t"], default: "," },
      { name: "includeHeader", type: "boolean", required: false, default: true },
      { name: "fileNamePattern", type: "string", required: false, default: "export-{n}.csv" },
    ],
  };

  async test(_config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult> {
    return healthResult(this.simulation, now, "export directory writable");
  }

  async send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("csv-file", failure);

    const columns = String(config["columns"])
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);
    const delimiter = String(config["delimiter"] ?? ",");
    const includeHeader = config["includeHeader"] !== false;
    const fileName = String(config["fileNamePattern"] ?? "export-{n}.csv").replace(
      "{n}",
      String(this.exports.length + 1),
    );

    const lines: string[] = [];
    if (includeHeader) lines.push(columns.join(delimiter));
    for (const message of messages) {
      lines.push(
        columns
          .map((column) => csvEscape(getPath(message.payload, column), delimiter))
          .join(delimiter),
      );
    }
    const content = lines.join("\n");
    this.exports.push({ fileName, content, rows: messages.length });

    return {
      accepted: messages.length,
      rejected: [],
      reference: fileName,
      latencyMs: this.simulation.latencyMs,
    };
  }

  async pull(): Promise<AdapterPullResult> {
    throw new AdapterUnavailableError("csv-file", "this driver is outbound-only");
  }
}

function csvEscape(value: unknown, delimiter: string): string {
  if (value === undefined || value === null) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (text.includes(delimiter) || text.includes('"') || text.includes("\n")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

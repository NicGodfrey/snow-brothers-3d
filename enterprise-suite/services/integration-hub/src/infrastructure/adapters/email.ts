/**
 * Email adapter: renders a notification per message from a subject/body
 * template. Used for low-volume human-facing integrations (a supplier that
 * wants an email per rejected lot rather than an API call).
 */
import type { IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { AdapterDescriptor, HealthCheckResult } from "../../domain/adapter.js";
import type {
  AdapterDriver,
  AdapterMessage,
  AdapterPullResult,
  AdapterSendResult,
} from "../../application/ports.js";
import { renderTemplate } from "../../domain/transform.js";
import { AdapterUnavailableError, healthResult, newSimulation, takeFailure } from "./simulation.js";

export interface SentEmail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export class EmailAdapterDriver implements AdapterDriver {
  readonly simulation = newSimulation({ latencyMs: 60 });
  readonly outbox: SentEmail[] = [];

  readonly descriptor: AdapterDescriptor = {
    kind: "email",
    displayName: "Email notification",
    direction: "outbound",
    capabilities: { supportsPush: true, supportsPull: false, supportsBatch: true, maxBatchSize: 100 },
    configSchema: [
      { name: "to", type: "string", required: true, description: "Comma-separated recipients" },
      { name: "from", type: "string", required: false, default: "no-reply@enterprise-suite.example" },
      {
        name: "subjectTemplate",
        type: "string",
        required: false,
        default: "[{{eventType}}] update",
        description: "Supports {{path}} placeholders over the message payload",
      },
      { name: "bodyTemplate", type: "string", required: false, default: "{{payload}}" },
      { name: "credentialsRef", type: "secret-ref", required: false },
    ],
  };

  async test(config: Readonly<Record<string, unknown>>, now: IsoDateTime): Promise<HealthCheckResult> {
    return healthResult(this.simulation, now, `SMTP relay ready for ${String(config["to"])}`);
  }

  async send(
    config: Readonly<Record<string, unknown>>,
    messages: readonly AdapterMessage[],
  ): Promise<AdapterSendResult> {
    const failure = takeFailure(this.simulation);
    if (failure) throw new AdapterUnavailableError("email", failure);

    const recipients = String(config["to"]);
    const subjectTemplate = String(config["subjectTemplate"] ?? "[{{eventType}}] update");
    const bodyTemplate = String(config["bodyTemplate"] ?? "{{payload}}");

    for (const message of messages) {
      const context = { eventType: message.eventType, key: message.key, payload: message.payload };
      this.outbox.push({
        to: recipients,
        subject: renderTemplate(subjectTemplate, context),
        body: renderTemplate(bodyTemplate, context),
      });
    }

    return {
      accepted: messages.length,
      rejected: [],
      reference: `mailto:${recipients}`,
      latencyMs: this.simulation.latencyMs,
    };
  }

  async pull(): Promise<AdapterPullResult> {
    throw new AdapterUnavailableError("email", "this driver is outbound-only");
  }
}

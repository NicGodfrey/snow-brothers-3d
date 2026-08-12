/**
 * Webhook transports.
 *
 * `FetchWebhookTransport` is the real one. `RecordingWebhookTransport` is a
 * programmable double used by tests and by the demo: it records every request
 * and answers from a queue of scripted responses, which is how retry,
 * dead-letter and circuit-breaker behaviour is exercised without a server.
 */
import type {
  TransportResult,
  WebhookRequest,
  WebhookResponse,
  WebhookTransport,
} from "../application/ports.js";

export class FetchWebhookTransport implements WebhookTransport {
  async send(request: WebhookRequest): Promise<TransportResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        body: request.body,
        signal: controller.signal,
      });
      const body = await response.text();
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      return {
        kind: "response",
        durationMs: Date.now() - startedAt,
        response: { statusCode: response.status, body, headers },
      };
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        kind: aborted ? "timeout" : "network-error",
        durationMs,
        error: aborted
          ? `request timed out after ${request.timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type ScriptedResponse =
  | { readonly status: number; readonly body?: string; readonly headers?: Record<string, string> }
  | { readonly networkError: string }
  | { readonly timeout: true };

export interface RecordedRequest extends WebhookRequest {
  readonly at: number;
}

/** Test/demo transport: scripted responses, full request history. */
export class RecordingWebhookTransport implements WebhookTransport {
  readonly requests: RecordedRequest[] = [];
  private readonly script: ScriptedResponse[] = [];
  private fallback: ScriptedResponse = { status: 200, body: "ok" };
  private latencyMs = 5;

  /** Queues responses, consumed one per request, oldest first. */
  enqueue(...responses: ScriptedResponse[]): this {
    this.script.push(...responses);
    return this;
  }

  /** Response used once the script is exhausted. */
  always(response: ScriptedResponse): this {
    this.fallback = response;
    return this;
  }

  withLatency(ms: number): this {
    this.latencyMs = ms;
    return this;
  }

  get callCount(): number {
    return this.requests.length;
  }

  lastRequest(): RecordedRequest | undefined {
    return this.requests[this.requests.length - 1];
  }

  reset(): void {
    this.requests.length = 0;
    this.script.length = 0;
  }

  async send(request: WebhookRequest): Promise<TransportResult> {
    this.requests.push({ ...request, at: Date.now() });
    const scripted = this.script.shift() ?? this.fallback;
    if ("networkError" in scripted) {
      return { kind: "network-error", error: scripted.networkError, durationMs: this.latencyMs };
    }
    if ("timeout" in scripted) {
      return {
        kind: "timeout",
        error: `request timed out after ${request.timeoutMs}ms`,
        durationMs: request.timeoutMs,
      };
    }
    const response: WebhookResponse = {
      statusCode: scripted.status,
      body: scripted.body ?? "",
      headers: scripted.headers ?? {},
    };
    return { kind: "response", response, durationMs: this.latencyMs };
  }
}

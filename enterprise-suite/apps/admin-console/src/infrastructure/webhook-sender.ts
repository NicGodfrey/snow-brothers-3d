import type { Clock, WebhookHttpResponse, WebhookSender } from "../application/ports.js";

/** Real deliveries over `fetch`, with a hard timeout per attempt. */
export class HttpWebhookSender implements WebhookSender {
  constructor(
    private readonly clock: Clock,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
    timeoutMs: number,
  ): Promise<WebhookHttpResponse> {
    const startedMs = this.clock.nowMs();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: { ...headers },
        body,
        signal: controller.signal,
      });
      return { statusCode: response.status, durationMs: this.clock.nowMs() - startedMs };
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      return {
        statusCode: 0,
        durationMs: this.clock.nowMs() - startedMs,
        error: aborted
          ? `timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface RecordedDelivery {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  readonly at: number;
}

/**
 * Records deliveries instead of sending them, and can be scripted to fail per
 * URL. Used by the demo runner and by every webhook test.
 */
export class RecordingWebhookSender implements WebhookSender {
  readonly sent: RecordedDelivery[] = [];
  private readonly responses = new Map<string, WebhookHttpResponse>();

  constructor(
    private readonly clock: Clock,
    private readonly defaultResponse: WebhookHttpResponse = { statusCode: 200, durationMs: 4 },
  ) {}

  /** Scripts the response for a URL; matches by prefix. */
  respondWith(urlPrefix: string, response: WebhookHttpResponse): this {
    this.responses.set(urlPrefix, response);
    return this;
  }

  async send(
    url: string,
    headers: Readonly<Record<string, string>>,
    body: string,
  ): Promise<WebhookHttpResponse> {
    this.sent.push({ url, headers: { ...headers }, body, at: this.clock.nowMs() });
    for (const [prefix, response] of this.responses) {
      if (url.startsWith(prefix)) return response;
    }
    return this.defaultResponse;
  }

  forUrl(urlPrefix: string): RecordedDelivery[] {
    return this.sent.filter((delivery) => delivery.url.startsWith(urlPrefix));
  }

  clear(): void {
    this.sent.length = 0;
  }
}

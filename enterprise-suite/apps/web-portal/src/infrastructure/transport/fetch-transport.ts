import { ApiError, type ApiRequest, type ApiResponse, type Transport } from "../../api/types.js";

/**
 * Real transport: `fetch` plus a per-request timeout. Non-JSON bodies come
 * back as text so an HTML error page from a proxy still reaches the caller as
 * a readable message instead of a parse crash.
 */
export class FetchTransport implements Transport {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(request: ApiRequest): Promise<ApiResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);
    try {
      const response = await this.fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal: controller.signal,
      });
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: await parseBody(response),
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new ApiError(
          `Timed out after ${request.timeoutMs}ms`,
          "timeout",
          0,
          request.url,
          request.requestId,
        );
      }
      throw new ApiError(
        error instanceof Error ? error.message : String(error),
        "network",
        0,
        request.url,
        request.requestId,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

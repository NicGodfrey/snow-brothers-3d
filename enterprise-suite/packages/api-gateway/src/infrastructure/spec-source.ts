import type { SpecSource } from "../application/ports.js";
import type { OpenApiDocument } from "../domain/openapi.js";
import type { UpstreamService } from "../domain/service-catalog.js";
import { describeError } from "./http-probe.js";

/** Fetches `<baseUrl><openapiPath>` and validates the minimum shape. */
export class HttpSpecSource implements SpecSource {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async fetchSpec(service: UpstreamService, timeoutMs: number): Promise<OpenApiDocument | undefined> {
    const url = `${service.baseUrl.replace(/\/$/, "")}${service.openapiPath}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await this.fetchImpl(url, {
        method: "GET",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (response.status === 404) return undefined;
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
      const document = (await response.json()) as OpenApiDocument;
      if (!document || typeof document !== "object" || typeof document.paths !== "object") {
        throw new Error(`${url} did not return an OpenAPI document`);
      }
      return document;
    } catch (error) {
      throw new Error(`spec fetch failed for ${service.id}: ${describeError(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** In-process specs, keyed by service id. Used by tests and the demo runner. */
export class StaticSpecSource implements SpecSource {
  constructor(
    private readonly documents: Readonly<Record<string, OpenApiDocument>> = {},
    private readonly failures: Readonly<Record<string, string>> = {},
  ) {}

  async fetchSpec(service: UpstreamService): Promise<OpenApiDocument | undefined> {
    const failure = this.failures[service.id];
    if (failure) throw new Error(failure);
    return this.documents[service.id];
  }
}

/** Always reports "no spec published", forcing route-table stubs. */
export class NullSpecSource implements SpecSource {
  async fetchSpec(): Promise<undefined> {
    return undefined;
  }
}

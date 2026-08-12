import { newId } from "@enterprise-suite/shared-kernel";
import {
  ApiError,
  buildQueryString,
  classifyStatus,
  toErrorBody,
  type ApiRequest,
  type HttpMethod,
  type RequestOptions,
  type Transport,
} from "./types.js";

/**
 * Base client every module stub extends.
 *
 * Responsibilities, in order: resolve the URL, attach auth/tenant headers,
 * enforce a timeout budget, retry idempotent failures with backoff, classify
 * errors, and report a telemetry record. Module stubs add nothing but types.
 */

export interface AuthHeaderProvider {
  /** Tenant/user/roles/authorization headers for the current session. */
  headers(requestId: string): Promise<Record<string, string>> | Record<string, string>;
}

export interface CallRecord {
  readonly service: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly status: number;
  readonly durationMs: number;
  readonly attempts: number;
  readonly requestId: string;
  readonly error?: string;
}

export interface ApiClientOptions {
  readonly service: string;
  readonly baseUrl: string;
  readonly transport: Transport;
  readonly auth: AuthHeaderProvider;
  readonly defaultTimeoutMs?: number;
  readonly retries?: number;
  readonly backoffMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly newRequestId?: () => string;
  readonly onCall?: (record: CallRecord) => void;
}

const RETRYABLE_METHODS: ReadonlySet<HttpMethod> = new Set<HttpMethod>(["GET", "PUT", "DELETE"]);

export class ApiClient {
  readonly service: string;
  private readonly baseUrl: string;
  private readonly transport: Transport;
  private readonly auth: AuthHeaderProvider;
  private readonly defaultTimeoutMs: number;
  private readonly retries: number;
  private readonly backoffMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly newRequestId: () => string;
  private readonly onCall?: (record: CallRecord) => void;

  constructor(options: ApiClientOptions) {
    this.service = options.service;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.transport = options.transport;
    this.auth = options.auth;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5_000;
    this.retries = options.retries ?? 2;
    this.backoffMs = options.backoffMs ?? 50;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.newRequestId = options.newRequestId ?? (() => newId("req"));
    this.onCall = options.onCall;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  post<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, options);
  }

  put<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PUT", path, options);
  }

  patch<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, options);
  }

  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  async request<T>(method: HttpMethod, path: string, options: RequestOptions = {}): Promise<T> {
    const requestId = this.newRequestId();
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}${buildQueryString(options.query)}`;
    const maxAttempts = this.attemptBudget(method, options);
    const started = this.now();
    let attempt = 0;
    let lastError: ApiError | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;
      if (options.signal?.aborted) {
        throw new ApiError("Request aborted", "network", 0, this.service, requestId);
      }
      const request: ApiRequest = {
        method,
        url,
        headers: await this.buildHeaders(requestId, options),
        body: options.body,
        timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
        requestId,
        attempt,
      };
      try {
        const response = await this.transport.send(request);
        if (response.status >= 200 && response.status < 300) {
          this.report({
            service: this.service,
            method,
            path,
            status: response.status,
            durationMs: this.now() - started,
            attempts: attempt,
            requestId,
          });
          return response.body as T;
        }
        lastError = this.errorFromResponse(response.status, response.body, requestId);
      } catch (error) {
        lastError =
          error instanceof ApiError
            ? error
            : new ApiError(
                error instanceof Error ? error.message : String(error),
                "network",
                0,
                this.service,
                requestId,
              );
      }

      if (!lastError.retryable || attempt >= maxAttempts) break;
      await this.sleep(this.backoffMs * 2 ** (attempt - 1));
    }

    const failure =
      lastError ?? new ApiError("Request failed", "unknown", 0, this.service, requestId);
    this.report({
      service: this.service,
      method,
      path,
      status: failure.status,
      durationMs: this.now() - started,
      attempts: attempt,
      requestId,
      error: failure.message,
    });
    throw failure;
  }

  private attemptBudget(method: HttpMethod, options: RequestOptions): number {
    if (options.retries !== undefined) return Math.max(1, options.retries + 1);
    const idempotent = RETRYABLE_METHODS.has(method) || options.idempotencyKey !== undefined;
    return idempotent ? this.retries + 1 : 1;
  }

  private async buildHeaders(
    requestId: string,
    options: RequestOptions,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-request-id": requestId,
      ...(await this.auth.headers(requestId)),
    };
    if (options.body !== undefined) headers["content-type"] = "application/json";
    if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
    return headers;
  }

  private errorFromResponse(status: number, body: unknown, requestId: string): ApiError {
    const parsed = toErrorBody(body);
    const kind = classifyStatus(status);
    return new ApiError(
      parsed.message ?? `${this.service} responded ${status}`,
      kind,
      status,
      this.service,
      requestId,
      parsed.code,
      parsed.details,
    );
  }

  private report(record: CallRecord): void {
    this.onCall?.(record);
  }
}

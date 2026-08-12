import type { Money, Page } from "@enterprise-suite/shared-kernel";

/**
 * Transport-level contracts shared by every generated module client.
 *
 * Clients never touch `fetch` directly: they build an `ApiRequest` and hand it
 * to a `Transport`. That keeps the portal testable (swap in a mock transport)
 * and keeps retry/auth/tracing in exactly one place.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue = string | number | boolean | undefined | null;

export interface ApiRequest {
  readonly method: HttpMethod;
  /** Absolute URL, already resolved against the module base URL. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
  readonly timeoutMs: number;
  /** Correlates the browser request, the BFF call and the service log line. */
  readonly requestId: string;
  readonly attempt: number;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface Transport {
  send(request: ApiRequest): Promise<ApiResponse>;
}

export interface RequestOptions {
  readonly query?: Readonly<Record<string, QueryValue>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly idempotencyKey?: string;
  /** Overrides the client default; 0 disables retries for this call. */
  readonly retries?: number;
  readonly signal?: AbortSignal;
}

export interface ListQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly q?: string;
  readonly sort?: string;
}

export type ApiPage<T> = Page<T>;

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "unauthorized"
  | "forbidden"
  | "not-found"
  | "conflict"
  | "validation"
  | "server"
  | "unknown";

/** Every failure a module client surfaces, already classified for the UI. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly status: number,
    readonly service: string,
    readonly requestId: string,
    readonly code?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get retryable(): boolean {
    return this.kind === "network" || this.kind === "timeout" || this.status >= 500;
  }
}

export function classifyStatus(status: number): ApiErrorKind {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "conflict";
  if (status === 400 || status === 422) return "validation";
  if (status >= 500) return "server";
  return "unknown";
}

export interface ErrorBody {
  readonly code?: string;
  readonly message?: string;
  readonly details?: unknown;
}

export function toErrorBody(body: unknown): ErrorBody {
  if (body && typeof body === "object") return body as ErrorBody;
  if (typeof body === "string" && body.length > 0) return { message: body };
  return {};
}

/** Shape shared by list rows so table views can stay generic. */
export interface RowLike {
  readonly id: string;
  readonly [key: string]: unknown;
}

export interface MoneyRow extends RowLike {
  readonly amount: Money;
}

export function buildQueryString(query?: Readonly<Record<string, QueryValue>>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

import { DomainError } from "@enterprise-suite/shared-kernel";

export interface ValidationIssue {
  readonly field: string;
  readonly message: string;
}

/** Request shape / configuration errors surfaced as 400. */
export class ValidationError extends DomainError {
  constructor(message: string, readonly issues: readonly ValidationIssue[] = []) {
    super(message, "VALIDATION", 400, issues.length > 0 ? issues : undefined);
    this.name = "ValidationError";
  }

  static single(field: string, message: string): ValidationError {
    return new ValidationError(`Invalid ${field}: ${message}`, [{ field, message }]);
  }
}

/** Two routes claim the same method + normalized pattern. */
export class RouteConflictError extends DomainError {
  constructor(
    readonly existingRouteId: string,
    readonly incomingRouteId: string,
    signature: string,
  ) {
    super(
      `Route ${incomingRouteId} conflicts with ${existingRouteId} on ${signature}`,
      "ROUTE_CONFLICT",
      409,
      { existingRouteId, incomingRouteId, signature },
    );
    this.name = "RouteConflictError";
  }
}

export class RouteNotFoundError extends DomainError {
  constructor(method: string, path: string) {
    super(`No route for ${method} ${path}`, "ROUTE_NOT_FOUND", 404);
    this.name = "RouteNotFoundError";
  }
}

export class MethodNotAllowedError extends DomainError {
  constructor(method: string, path: string, readonly allowed: readonly string[]) {
    super(`${method} not allowed on ${path}`, "METHOD_NOT_ALLOWED", 405, { allowed });
    this.name = "MethodNotAllowedError";
  }
}

export class UnknownUpstreamError extends DomainError {
  constructor(serviceId: string) {
    super(`Unknown upstream service: ${serviceId}`, "UNKNOWN_UPSTREAM", 502, { serviceId });
    this.name = "UnknownUpstreamError";
  }
}

export class UpstreamUnavailableError extends DomainError {
  constructor(serviceId: string, detail?: string) {
    super(`Upstream ${serviceId} is unavailable`, "UPSTREAM_UNAVAILABLE", 503, { serviceId, detail });
    this.name = "UpstreamUnavailableError";
  }
}

export class TenantRequiredError extends DomainError {
  constructor(header = "x-tenant-id") {
    super(`${header} header is required`, "TENANT_REQUIRED", 400, { header });
    this.name = "TenantRequiredError";
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = "Authentication required") {
    super(message, "UNAUTHENTICATED", 401);
    this.name = "UnauthenticatedError";
  }
}

export class RateLimitExceededError extends DomainError {
  constructor(readonly retryAfterMs: number, readonly limit: number, readonly windowMs: number) {
    super("Rate limit exceeded", "RATE_LIMITED", 429, {
      retryAfterMs,
      limit,
      windowMs,
    });
    this.name = "RateLimitExceededError";
  }
}

export class SpecAggregationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, "SPEC_AGGREGATION_FAILED", 502, details);
    this.name = "SpecAggregationError";
  }
}

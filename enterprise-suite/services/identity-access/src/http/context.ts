import type { IncomingMessage } from "node:http";
import { DomainError, newId, tenantId as toTenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { AuthenticationService } from "../application/authentication-service.js";
import type { Principal } from "../application/principal.js";
import { userSubject } from "../domain/subject.js";

export interface RequestIdentity {
  readonly principal: Principal;
  readonly ip?: string;
  readonly correlationId: Ulid;
}

/**
 * Resolves the caller from the request. A bearer token is authenticated properly; the
 * `x-tenant-id` / `x-user-id` header pair is the trusted-internal path used by other
 * services in the monolith, matching the convention in docs/ARCHITECTURE.md.
 */
export function identifyRequest(
  req: IncomingMessage,
  authentication: AuthenticationService,
  options: { trustHeaders?: boolean } = {},
): RequestIdentity {
  const correlationId = headerValue(req, "x-correlation-id")
    ? (headerValue(req, "x-correlation-id") as Ulid)
    : newId("req");
  const ip = clientIp(req);

  const authorization = headerValue(req, "authorization");
  if (authorization) {
    const principal = authentication.authenticateBearer(authorization, { ip });
    return { principal: { ...principal, correlationId }, ip, correlationId };
  }

  const tenantHeader = headerValue(req, "x-tenant-id");
  const userHeader = headerValue(req, "x-user-id");
  if ((options.trustHeaders ?? true) && tenantHeader && userHeader) {
    return {
      principal: {
        tenantId: toTenantId(tenantHeader),
        subject: userSubject(userHeader),
        displayName: userHeader,
        amr: [],
        mfaSatisfied: false,
        correlationId,
      },
      ip,
      correlationId,
    };
  }

  throw new DomainError(
    "Missing credentials: send an Authorization bearer token or x-tenant-id/x-user-id",
    "UNAUTHENTICATED",
    401,
  );
}

export function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return value;
}

export function clientIp(req: IncomingMessage): string | undefined {
  const forwarded = headerValue(req, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.socket?.remoteAddress ?? undefined;
}

/** Tenant for endpoints that operate on a tenant other than the caller's own. */
export function tenantFromPathOrPrincipal(
  params: Readonly<Record<string, string>>,
  principal: Principal,
): ReturnType<typeof toTenantId> {
  return params.tenantId ? toTenantId(params.tenantId) : principal.tenantId;
}

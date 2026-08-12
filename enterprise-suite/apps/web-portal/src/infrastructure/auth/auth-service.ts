import {
  DomainError,
  ForbiddenError,
  brand,
  newId,
  signSuiteToken,
  verifySuiteToken,
  type IsoDateTime,
  type SuiteTokenClaims,
} from "@enterprise-suite/shared-kernel";
import type { AuthHeaderProvider } from "../../api/client.js";
import { createSession, sessionHeaders, type PortalSession, type TenantHeaders } from "../../domain/session.js";
import type { Clock } from "../clock.js";
import { Directory } from "./directory.js";

/**
 * Mock authentication and tenant resolution.
 *
 * Two ways in, both producing the same `PortalSession`:
 *
 *  - `signIn` mints a shared suite bearer token that the browser carries in
 *    the `portal_session` cookie;
 *  - `sessionFromHeaders` trusts `x-tenant-id` / `x-user-id` / `x-roles`
 *    directly, which is how the gateway will inject an already-authenticated
 *    principal and how tests and curl drive the portal.
 *
 * Header mode is refused unless explicitly enabled so it cannot be left on by
 * accident in a deployment that terminates auth at the portal.
 */

export interface AuthServiceOptions {
  readonly secret: string;
  readonly ttlMinutes: number;
  readonly clock: Clock;
  readonly directory?: Directory;
  /** Allow `x-tenant-id`/`x-user-id` to establish a session without a token. */
  readonly trustHeaders?: boolean;
}

export interface SignInInput {
  readonly email: string;
  readonly tenantId?: string;
  /** Admin acting on behalf of another user; requires `tenant-admin`. */
  readonly impersonateUserId?: string;
}

export interface SignInResult {
  readonly token: string;
  readonly session: PortalSession;
  readonly expiresAt: string;
}

export class AuthService {
  readonly directory: Directory;
  private readonly secret: string;
  private readonly ttlMs: number;
  private readonly clock: Clock;
  private readonly trustHeaders: boolean;

  constructor(options: AuthServiceOptions) {
    this.directory = options.directory ?? new Directory();
    this.secret = options.secret;
    this.ttlMs = options.ttlMinutes * 60_000;
    this.clock = options.clock;
    this.trustHeaders = options.trustHeaders ?? false;
  }

  signIn(input: SignInInput): SignInResult {
    const user = this.directory.userByEmail(input.email);
    if (!user) throw new DomainError(`Unknown user: ${input.email}`, "INVALID_CREDENTIALS", 401);

    const tenantId = input.tenantId ?? Object.keys(user.memberships)[0];
    if (!tenantId) throw new ForbiddenError(`${user.userId} belongs to no tenant`);
    const tenant = this.directory.tenant(tenantId);
    if (!tenant) throw new DomainError(`Unknown tenant: ${tenantId}`, "NOT_FOUND", 404);

    let session = this.buildSession(user.userId, tenant.tenantId, undefined, undefined);
    if (input.impersonateUserId) {
      session.permissions.require("*");
      session = this.buildSession(
        input.impersonateUserId,
        tenant.tenantId,
        session.user.userId,
        session.sessionId,
      );
    }
    return { token: this.tokenFor(session), session, expiresAt: session.expiresAt };
  }

  switchTenant(session: PortalSession, tenantId: string): SignInResult {
    if (!(tenantId in session.user.memberships)) {
      throw new ForbiddenError(`${session.user.userId} is not a member of ${tenantId}`);
    }
    const next = this.buildSession(
      session.user.userId,
      tenantId,
      session.impersonatedBy,
      session.sessionId,
    );
    return { token: this.tokenFor(next), session: next, expiresAt: next.expiresAt };
  }

  sessionFromToken(token: string): PortalSession {
    const claims = verifySuiteToken(token, this.secret, { nowMs: this.clock.epochMs() });
    return this.sessionFromClaims(claims);
  }

  /** Header-injected principal (gateway mode). Returns undefined when absent. */
  sessionFromHeaders(headers: Readonly<Record<string, string | undefined>>): PortalSession | undefined {
    const tenantId = headers["x-tenant-id"];
    const userId = headers["x-user-id"];
    if (!tenantId || !userId) return undefined;
    if (!this.trustHeaders) {
      throw new ForbiddenError("Header authentication is disabled on this deployment");
    }
    const roles = (headers["x-roles"] ?? "")
      .split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    return this.buildSession(
      userId,
      tenantId,
      headers["x-on-behalf-of"],
      undefined,
      roles.length > 0 ? roles : undefined,
    );
  }

  tokenFor(session: PortalSession): string {
    const claims: SuiteTokenClaims = {
      userId: session.user.userId,
      tenantId: session.tenant.tenantId,
      roles: session.roles,
      sessionId: session.sessionId,
      iat: Math.floor(Date.parse(session.issuedAt) / 1000),
      exp: Math.floor(Date.parse(session.expiresAt) / 1000),
      impersonatedBy: session.impersonatedBy,
    };
    return signSuiteToken(claims, this.secret);
  }

  headers(session: PortalSession): TenantHeaders {
    return { ...sessionHeaders(session), authorization: `Bearer ${this.tokenFor(session)}` };
  }

  /** Adapter handed to every `ApiClient` so outbound calls carry the session. */
  headerProvider(session: PortalSession): AuthHeaderProvider {
    const headers = this.headers(session);
    return {
      headers: (requestId: string) => ({ ...headers, "x-correlation-id": requestId }),
    };
  }

  private sessionFromClaims(claims: SuiteTokenClaims): PortalSession {
    return this.buildSession(
      claims.userId,
      claims.tenantId,
      claims.impersonatedBy,
      claims.sessionId,
      claims.roles,
    );
  }

  private buildSession(
    userId: string,
    tenantId: string,
    impersonatedBy?: string,
    sessionId?: string,
    roles?: readonly string[],
  ): PortalSession {
    const user = this.directory.user(userId);
    if (!user) throw new DomainError(`Unknown user: ${userId}`, "INVALID_CREDENTIALS", 401);
    const tenant = this.directory.tenant(tenantId);
    if (!tenant) throw new DomainError(`Unknown tenant: ${tenantId}`, "NOT_FOUND", 404);

    const issuedAt = this.clock.now();
    return createSession({
      sessionId: sessionId ?? newId("sess"),
      tenant,
      user,
      roles,
      issuedAt: brand<string, "IsoDateTime">(issuedAt),
      expiresAt: brand<string, "IsoDateTime">(
        new Date(this.clock.epochMs() + this.ttlMs).toISOString(),
      ) as IsoDateTime,
      impersonatedBy,
    });
  }
}

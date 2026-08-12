import { DomainError } from "@enterprise-suite/shared-kernel";
import type { PortalContainer } from "../../infrastructure/container.js";
import { clearSessionCookie, sessionCookie } from "../cookies.js";
import { requireSession } from "../context.js";
import { htmlResponse, json, redirect, Router, type PortalRequest } from "../router.js";
import { signInPage } from "../views/pages/sign-in.js";

/** Sign-in, sign-out, tenant switching and the session probe used by the BFF. */
export function registerAuthRoutes(router: Router, container: PortalContainer): void {
  const cookieFor = (token: string): string =>
    sessionCookie(token, { maxAgeSeconds: container.config.sessionTtlMinutes * 60 });

  router.get("/sign-in", (req) =>
    htmlResponse(
      200,
      signInPage({
        users: container.directory.listUsers(),
        tenants: container.directory.listTenants(),
        next: req.query.get("next") ?? "/",
      }),
    ),
  );

  router.post("/sign-in", (req) => {
    const body = asRecord(req.body);
    const email = string(body.email);
    if (!email) throw new DomainError("email is required", "VALIDATION", 400);
    const tenantId = string(body.tenantId);
    const next = string(body.next) ?? "/";
    try {
      const result = container.auth.signIn({
        email,
        tenantId,
        impersonateUserId: string(body.impersonateUserId),
      });
      if (wantsJson(req)) {
        return {
          status: 200,
          json: {
            token: result.token,
            expiresAt: result.expiresAt,
            tenantId: result.session.tenant.tenantId,
            roles: result.session.roles,
          },
          headers: { "set-cookie": cookieFor(result.token) },
        };
      }
      return redirect(next.startsWith("/") ? next : "/", [cookieFor(result.token)]);
    } catch (error) {
      if (wantsJson(req)) throw error;
      return htmlResponse(
        error instanceof DomainError ? error.status : 500,
        signInPage({
          users: container.directory.listUsers(),
          tenants: container.directory.listTenants(),
          error: error instanceof Error ? error.message : "Sign-in failed",
          next,
        }),
      );
    }
  });

  router.post("/sign-out", (req) =>
    wantsJson(req)
      ? { status: 200, json: { signedOut: true }, headers: { "set-cookie": clearSessionCookie() } }
      : redirect("/sign-in", [clearSessionCookie()]),
  );

  router.post("/switch-tenant", (req) => {
    const session = requireSession(req);
    const body = asRecord(req.body);
    const tenantId = string(body.tenantId);
    if (!tenantId) throw new DomainError("tenantId is required", "VALIDATION", 400);
    const result = container.auth.switchTenant(session, tenantId);
    if (wantsJson(req)) {
      return {
        status: 200,
        json: { tenantId: result.session.tenant.tenantId, roles: result.session.roles },
        headers: { "set-cookie": cookieFor(result.token) },
      };
    }
    return redirect("/", [cookieFor(result.token)]);
  });

  router.get("/api/session", (req) => {
    const session = requireSession(req);
    return json(200, {
      sessionId: session.sessionId,
      tenant: {
        tenantId: session.tenant.tenantId,
        name: session.tenant.name,
        entitlements: session.tenant.entitlements,
        featureFlags: session.tenant.featureFlags,
      },
      user: {
        userId: session.user.userId,
        displayName: session.user.displayName,
        email: session.user.email,
      },
      roles: session.roles,
      permissions: session.permissions.list(),
      expiresAt: session.expiresAt,
      impersonatedBy: session.impersonatedBy,
    });
  });
}

function wantsJson(req: PortalRequest): boolean {
  const accept = req.headers.accept ?? "";
  const contentType = req.headers["content-type"] ?? "";
  return (
    req.path.startsWith("/api/") ||
    contentType.includes("application/json") ||
    (accept.includes("application/json") && !accept.includes("text/html"))
  );
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

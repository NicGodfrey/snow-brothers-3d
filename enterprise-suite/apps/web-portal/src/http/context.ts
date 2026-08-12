import { DomainError } from "@enterprise-suite/shared-kernel";
import type { ShellModel } from "../application/navigation-service.js";
import type { PortalPreferences } from "../domain/preferences.js";
import type { PortalSession } from "../domain/session.js";
import type { PortalContainer, SessionScope } from "../infrastructure/container.js";
import type { PortalRequest } from "./router.js";

/**
 * Per-request assembly: session, preferences, per-session clients and the
 * shell model every HTML page renders inside.
 */

export interface PageContext {
  readonly session: PortalSession;
  readonly preferences: PortalPreferences;
  readonly shell: ShellModel;
  readonly scope: SessionScope;
  readonly locale: string;
}

export function requireSession(req: PortalRequest): PortalSession {
  if (!req.session) {
    throw new DomainError("Authentication required", "UNAUTHENTICATED", 401);
  }
  return req.session;
}

export async function pageContext(
  container: PortalContainer,
  req: PortalRequest,
  overridePath?: string,
): Promise<PageContext> {
  const session = requireSession(req);
  const preferences = await container.preferences.load(session);
  return {
    session,
    preferences,
    shell: container.navigation.build(session, overridePath ?? req.path, preferences),
    scope: container.forSession(session),
    locale: preferences.locale,
  };
}

export function signInRedirect(req: PortalRequest): string {
  const next = req.path === "/" ? "" : `?next=${encodeURIComponent(req.path)}`;
  return `/sign-in${next}`;
}

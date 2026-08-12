import {
  createTenantContext,
  type RoleCode,
  type TenantContext,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { GrantPattern } from "../domain/permission-key.js";
import type { AuthMethod } from "../domain/session.js";
import { subjectKey, type SubjectRef } from "../domain/subject.js";

/**
 * The authenticated caller. Produced by authentication, consumed by authorization —
 * nothing downstream should ever construct one from raw request headers except the HTTP
 * adapter, which is why `fromContext` is explicit about being a trusted-edge conversion.
 */
export interface Principal {
  readonly tenantId: TenantId;
  readonly subject: SubjectRef;
  readonly displayName: string;
  readonly sessionId?: Ulid;
  readonly apiKeyId?: Ulid;
  /** API key scope-down patterns; empty or absent means "whatever the roles allow". */
  readonly restrictions?: readonly GrantPattern[];
  readonly amr: readonly AuthMethod[];
  readonly mfaSatisfied: boolean;
  readonly correlationId?: Ulid;
  /** Set when an administrator is acting on behalf of the subject. */
  readonly impersonatedBy?: Ulid;
}

export function principalLabel(principal: Principal): string {
  return `${subjectKey(principal.subject)} (${principal.displayName})`;
}

/**
 * Bridges to the shared-kernel `TenantContext` used by other bounded contexts. Roles are
 * carried for logging and coarse checks only; real decisions go through the evaluator.
 */
export function toTenantContext(
  principal: Principal,
  roles: readonly RoleCode[] = [],
): TenantContext {
  return {
    ...createTenantContext(principal.tenantId, principal.subject.id, [...roles]),
    requestId: principal.correlationId ?? createTenantContext(principal.tenantId, principal.subject.id).requestId,
  };
}

/** Trusted-edge conversion: only for internal callers that already authenticated. */
export function principalFromContext(context: TenantContext): Principal {
  return {
    tenantId: context.tenantId,
    subject: { type: "user", id: context.userId as unknown as Ulid },
    displayName: context.userId,
    amr: [],
    mfaSatisfied: false,
    correlationId: context.requestId,
  };
}

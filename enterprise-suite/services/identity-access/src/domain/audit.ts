import { Entity, type IsoDateTime, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { DecisionReason } from "./decision.js";
import { newAuditId } from "./ids.js";
import type { PermissionKey } from "./permission-key.js";
import type { ScopePath } from "./scope.js";
import { subjectKey, type SubjectRef } from "./subject.js";

export type AuditCategory = "authz" | "authn" | "admin";
export type AuditOutcome = "allow" | "deny" | "success" | "failure";

interface AuditEntryProps {
  readonly at: IsoDateTime;
  readonly category: AuditCategory;
  /** Dotted action name, e.g. `authz.check`, `admin.role_binding.granted`. */
  readonly action: string;
  readonly outcome: AuditOutcome;
  readonly subject: SubjectRef;
  readonly permission?: PermissionKey;
  readonly scope?: ScopePath;
  readonly reason?: DecisionReason | string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly actorId?: Ulid;
  readonly correlationId?: Ulid;
  readonly ip?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Append-only record of an authorization decision or an administrative change.
 * Entries are immutable: there are no mutating methods and no domain events, because an
 * audit entry is itself the record of something that already happened.
 */
export class AuditEntry extends Entity<AuditEntryProps> {
  private constructor(tenantId: TenantId, props: AuditEntryProps, id?: Ulid) {
    super(tenantId, props, { id: id ?? newAuditId(), createdAt: props.at, updatedAt: props.at });
  }

  static record(input: {
    tenantId: TenantId;
    at: IsoDateTime;
    category: AuditCategory;
    action: string;
    outcome: AuditOutcome;
    subject: SubjectRef;
    permission?: PermissionKey;
    scope?: ScopePath;
    reason?: DecisionReason | string;
    resourceType?: string;
    resourceId?: string;
    actorId?: Ulid;
    correlationId?: Ulid;
    ip?: string;
    metadata?: Record<string, unknown>;
  }): AuditEntry {
    return new AuditEntry(input.tenantId, {
      at: input.at,
      category: input.category,
      action: input.action,
      outcome: input.outcome,
      subject: input.subject,
      permission: input.permission,
      scope: input.scope,
      reason: input.reason,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      actorId: input.actorId,
      correlationId: input.correlationId,
      ip: input.ip,
      metadata: { ...(input.metadata ?? {}) },
    });
  }

  get at(): IsoDateTime {
    return this.props.at;
  }

  get category(): AuditCategory {
    return this.props.category;
  }

  get action(): string {
    return this.props.action;
  }

  get outcome(): AuditOutcome {
    return this.props.outcome;
  }

  get subject(): SubjectRef {
    return this.props.subject;
  }

  get permission(): PermissionKey | undefined {
    return this.props.permission;
  }

  get scope(): ScopePath | undefined {
    return this.props.scope;
  }

  get reason(): string | undefined {
    return this.props.reason;
  }

  get resourceId(): string | undefined {
    return this.props.resourceId;
  }

  get actorId(): Ulid | undefined {
    return this.props.actorId;
  }

  get correlationId(): Ulid | undefined {
    return this.props.correlationId;
  }

  get metadata(): Readonly<Record<string, unknown>> {
    return this.props.metadata;
  }

  /** One-line rendering for log shipping. */
  toLogLine(): string {
    const parts = [
      this.props.at,
      this.props.category.toUpperCase(),
      this.props.action,
      this.props.outcome.toUpperCase(),
      subjectKey(this.props.subject),
    ];
    if (this.props.permission) parts.push(`${this.props.permission}@${this.props.scope ?? "-"}`);
    if (this.props.reason) parts.push(`(${this.props.reason})`);
    return parts.join(" ");
  }
}

export interface AuditQuery {
  readonly category?: AuditCategory;
  readonly outcome?: AuditOutcome;
  readonly subject?: SubjectRef;
  readonly action?: string;
  readonly permission?: PermissionKey;
  readonly scopePrefix?: string;
  readonly from?: IsoDateTime;
  readonly to?: IsoDateTime;
  readonly correlationId?: Ulid;
}

export function matchesAuditQuery(entry: AuditEntry, query: AuditQuery): boolean {
  if (query.category && entry.category !== query.category) return false;
  if (query.outcome && entry.outcome !== query.outcome) return false;
  if (query.action && entry.action !== query.action) return false;
  if (query.permission && entry.permission !== query.permission) return false;
  if (query.correlationId && entry.correlationId !== query.correlationId) return false;
  if (query.subject) {
    if (subjectKey(entry.subject) !== subjectKey(query.subject)) return false;
  }
  if (query.scopePrefix) {
    const scope = entry.scope ?? "";
    if (!scope.startsWith(query.scopePrefix)) return false;
  }
  if (query.from && Date.parse(entry.at) < Date.parse(query.from)) return false;
  if (query.to && Date.parse(entry.at) > Date.parse(query.to)) return false;
  return true;
}

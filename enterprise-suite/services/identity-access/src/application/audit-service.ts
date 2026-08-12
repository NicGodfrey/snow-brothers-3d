import {
  normalizePage,
  type Page,
  type PageRequest,
  type TenantId,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { AuditEntry, type AuditCategory, type AuditQuery } from "../domain/audit.js";
import type { DecisionReason } from "../domain/decision.js";
import { permissionKey } from "../domain/permission-key.js";
import { scopePath } from "../domain/scope.js";
import type { SubjectRef } from "../domain/subject.js";
import { subjectKey } from "../domain/subject.js";
import type { AuditRepository, Clock } from "./ports.js";

export interface DenialSummaryRow {
  readonly permission: string;
  readonly reason: DecisionReason | string;
  readonly count: number;
  readonly lastAt: string;
}

export interface SubjectActivityRow {
  readonly subject: string;
  readonly allows: number;
  readonly denies: number;
  readonly lastAt: string;
}

/**
 * Read/write facade over the audit log. Writes here are for administrative actions that
 * do not belong to another service; authorization decisions are written by
 * `AuthorizationService` at the moment they are made.
 */
export class AuditService {
  constructor(
    private readonly audit: AuditRepository,
    private readonly clock: Clock,
  ) {}

  record(input: {
    tenantId: TenantId;
    category: AuditCategory;
    action: string;
    outcome: "allow" | "deny" | "success" | "failure";
    subject: SubjectRef;
    permission?: string;
    scope?: string;
    reason?: string;
    resourceType?: string;
    resourceId?: string;
    actorId?: Ulid;
    correlationId?: Ulid;
    ip?: string;
    metadata?: Record<string, unknown>;
  }): AuditEntry {
    const entry = AuditEntry.record({
      ...input,
      at: this.clock.now(),
      permission: input.permission ? permissionKey(input.permission) : undefined,
      scope: input.scope ? scopePath(input.scope) : undefined,
    });
    this.audit.append(entry);
    return entry;
  }

  list(tenantId: TenantId, query: AuditQuery = {}): readonly AuditEntry[] {
    return this.audit.list(tenantId, query);
  }

  page(tenantId: TenantId, request?: Partial<PageRequest>, query: AuditQuery = {}): Page<AuditEntry> {
    return this.audit.page(tenantId, normalizePage(request), query);
  }

  /** Recent denials, newest first — the first thing anyone looks at after a complaint. */
  recentDenials(tenantId: TenantId, limit = 50): readonly AuditEntry[] {
    return this.audit
      .list(tenantId, { category: "authz", outcome: "deny" })
      .slice(0, Math.max(1, limit));
  }

  /** Groups denials by permission and reason to surface systemic gaps in role design. */
  denialSummary(tenantId: TenantId, since?: string): readonly DenialSummaryRow[] {
    const rows = new Map<string, { count: number; lastAt: string }>();
    for (const entry of this.audit.list(tenantId, { category: "authz", outcome: "deny" })) {
      if (since && Date.parse(entry.at) < Date.parse(since)) continue;
      const key = `${entry.permission ?? "-"}|${entry.reason ?? "-"}`;
      const existing = rows.get(key);
      if (existing) {
        existing.count += 1;
        if (entry.at > existing.lastAt) existing.lastAt = entry.at;
      } else {
        rows.set(key, { count: 1, lastAt: entry.at });
      }
    }
    return [...rows.entries()]
      .map(([key, value]) => {
        const [permission, reason] = key.split("|");
        return { permission, reason, count: value.count, lastAt: value.lastAt };
      })
      .sort((a, b) => b.count - a.count || a.permission.localeCompare(b.permission));
  }

  /** Per-subject allow/deny tallies, used for anomaly review. */
  subjectActivity(tenantId: TenantId, since?: string): readonly SubjectActivityRow[] {
    const rows = new Map<string, { allows: number; denies: number; lastAt: string }>();
    for (const entry of this.audit.list(tenantId, { category: "authz" })) {
      if (since && Date.parse(entry.at) < Date.parse(since)) continue;
      const key = subjectKey(entry.subject);
      const row = rows.get(key) ?? { allows: 0, denies: 0, lastAt: entry.at };
      if (entry.outcome === "allow") row.allows += 1;
      if (entry.outcome === "deny") row.denies += 1;
      if (entry.at > row.lastAt) row.lastAt = entry.at;
      rows.set(key, row);
    }
    return [...rows.entries()]
      .map(([subject, value]) => ({ subject, ...value }))
      .sort((a, b) => b.denies - a.denies || b.allows - a.allows);
  }

  /** Everything recorded under one correlation id, i.e. one inbound request. */
  trace(tenantId: TenantId, correlationId: Ulid): readonly AuditEntry[] {
    return [...this.audit.list(tenantId, { correlationId })].sort((a, b) =>
      a.at.localeCompare(b.at),
    );
  }

  /** Newline-delimited JSON for shipping to an external SIEM. */
  exportNdjson(tenantId: TenantId, query: AuditQuery = {}): string {
    return this.audit
      .list(tenantId, query)
      .map((entry) => JSON.stringify(entry.toJSON()))
      .join("\n");
  }

  count(tenantId: TenantId, query: AuditQuery = {}): number {
    return this.audit.count(tenantId, query);
  }
}

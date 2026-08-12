import {
  normalizePage,
  type Page,
  type PageRequest,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import {
  createAuditEntry,
  matchesAuditQuery,
  summarizeAudit,
  type AuditEntry,
  type AuditOutcome,
  type AuditQuery,
} from "../domain/audit.js";
import type { AuditRepository, Clock, CommandContext } from "./ports.js";

/**
 * Writes and reads the audit trail. Every other service depends on this one:
 * a command that mutates state and does not produce an audit entry is a bug.
 */
export class AuditService {
  constructor(
    private readonly repository: AuditRepository,
    private readonly clock: Clock,
  ) {}

  record(
    ctx: CommandContext,
    input: {
      action: string;
      resourceType: string;
      resourceId: string;
      outcome?: AuditOutcome;
      before?: unknown;
      after?: unknown;
      reason?: string;
    },
  ): AuditEntry {
    const entry = createAuditEntry({
      tenantId: ctx.tenantId,
      at: this.clock.now(),
      actor: ctx.actor,
      actorRoles: ctx.roles,
      requestId: ctx.requestId,
      sourceIp: ctx.sourceIp,
      ...input,
    });
    this.repository.append(entry);
    return entry;
  }

  /** Records the denial of a command so refused attempts are visible too. */
  recordDenied(
    ctx: CommandContext,
    input: { action: string; resourceType: string; resourceId: string; reason: string },
  ): AuditEntry {
    return this.record(ctx, { ...input, outcome: "denied" });
  }

  query(tenantId: TenantId, query: AuditQuery, page?: Partial<PageRequest>): Page<AuditEntry> {
    const request: PageRequest = normalizePage(page);
    return this.repository.query(tenantId, query, request);
  }

  summary(tenantId: TenantId, query: AuditQuery = {}): ReturnType<typeof summarizeAudit> {
    const entries = this.repository
      .all(tenantId)
      .filter((entry) => matchesAuditQuery(entry, query));
    return summarizeAudit(entries);
  }
}

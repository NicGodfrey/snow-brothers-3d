import { newId, type IsoDateTime, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";

/**
 * Audit log.
 *
 * Every state-changing admin command writes one entry. Entries are immutable
 * and never carry secrets: payloads pass through {@link redact}, which strips
 * anything whose key looks like a credential. Compliance reads this log, so
 * "who changed what, from where, and what did it look like before" has to be
 * answerable without replaying events.
 */

export const AUDIT_OUTCOMES = ["success", "denied", "error"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export interface AuditEntry {
  readonly id: Ulid;
  readonly tenantId: TenantId;
  readonly at: IsoDateTime;
  readonly actor: string;
  readonly actorRoles: readonly string[];
  /** Verb in `<resource>.<action>` form, e.g. `feature-flag.toggle`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome: AuditOutcome;
  readonly requestId?: string;
  readonly sourceIp?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string;
}

export interface RecordAuditInput {
  readonly tenantId: TenantId;
  readonly at: IsoDateTime;
  readonly actor: string;
  readonly actorRoles?: readonly string[];
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly outcome?: AuditOutcome;
  readonly requestId?: string;
  readonly sourceIp?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly reason?: string;
}

export function createAuditEntry(input: RecordAuditInput): AuditEntry {
  return {
    id: newId("aud"),
    tenantId: input.tenantId,
    at: input.at,
    actor: input.actor,
    actorRoles: [...(input.actorRoles ?? [])],
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    outcome: input.outcome ?? "success",
    requestId: input.requestId,
    sourceIp: input.sourceIp,
    before: redact(input.before),
    after: redact(input.after),
    reason: input.reason,
  };
}

const SECRET_KEY_PATTERN = /secret|token|password|credential|apikey|api_key|authorization/i;
export const REDACTED = "[redacted]";

/** Recursively replaces credential-looking values with a marker. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined || depth > 8) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
  }
  return out;
}

export interface AuditQuery {
  readonly actor?: string;
  readonly action?: string;
  readonly resourceType?: string;
  readonly resourceId?: string;
  readonly outcome?: AuditOutcome;
  readonly from?: string;
  readonly to?: string;
  readonly search?: string;
}

export function matchesAuditQuery(entry: AuditEntry, query: AuditQuery): boolean {
  if (query.actor && entry.actor !== query.actor) return false;
  if (query.action && !entry.action.startsWith(query.action)) return false;
  if (query.resourceType && entry.resourceType !== query.resourceType) return false;
  if (query.resourceId && entry.resourceId !== query.resourceId) return false;
  if (query.outcome && entry.outcome !== query.outcome) return false;
  if (query.from && Date.parse(entry.at) < Date.parse(query.from)) return false;
  if (query.to && Date.parse(entry.at) > Date.parse(query.to)) return false;
  if (query.search) {
    const needle = query.search.toLowerCase();
    const haystack = `${entry.action} ${entry.resourceType} ${entry.resourceId} ${entry.actor} ${entry.reason ?? ""}`;
    if (!haystack.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/** Rollup for the console dashboard: who is changing what, and how often. */
export function summarizeAudit(entries: readonly AuditEntry[]): {
  total: number;
  byOutcome: Record<AuditOutcome, number>;
  byAction: Record<string, number>;
  topActors: { actor: string; count: number }[];
} {
  const byOutcome: Record<AuditOutcome, number> = { success: 0, denied: 0, error: 0 };
  const byAction: Record<string, number> = {};
  const byActor = new Map<string, number>();

  for (const entry of entries) {
    byOutcome[entry.outcome] += 1;
    byAction[entry.action] = (byAction[entry.action] ?? 0) + 1;
    byActor.set(entry.actor, (byActor.get(entry.actor) ?? 0) + 1);
  }

  const topActors = [...byActor.entries()]
    .map(([actor, count]) => ({ actor, count }))
    .sort((a, b) => b.count - a.count || a.actor.localeCompare(b.actor))
    .slice(0, 10);

  return { total: entries.length, byOutcome, byAction, topActors };
}

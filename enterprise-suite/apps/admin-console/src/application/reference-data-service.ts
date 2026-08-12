import { NotFoundError, type IsoDateTime, type TenantId } from "@enterprise-suite/shared-kernel";
import { DuplicateError } from "../domain/errors.js";
import {
  ReferenceDataSet,
  type CreateReferenceSetInput,
  type ReferenceEntry,
  type ReferenceEntryInput,
  type ReferenceTreeNode,
} from "../domain/reference-data.js";
import type { AuditService } from "./audit-service.js";
import type { TenantService } from "./tenant-service.js";
import type {
  Clock,
  CommandContext,
  Outbox,
  ReferenceDataRepository,
} from "./ports.js";

/**
 * Reference data administration and the read path domain services use.
 *
 * Writes go through the draft/publish cycle on the aggregate; reads resolve
 * entries as of a point in time so a document created last quarter still shows
 * the code list that was live when it was written.
 */
export class ReferenceDataService {
  constructor(
    private readonly sets: ReferenceDataRepository,
    private readonly tenantService: TenantService,
    private readonly outbox: Outbox,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  async createSet(ctx: CommandContext, input: CreateReferenceSetInput): Promise<ReferenceDataSet> {
    const tenant = this.tenantService.requireOperational(ctx.tenantId);
    const code = input.code.trim().toLowerCase();
    if (this.sets.byCode(ctx.tenantId, code)) {
      throw new DuplicateError("ReferenceDataSet", "code", code);
    }
    tenant.assertWithinQuota("referenceSets", this.sets.count(ctx.tenantId));

    const set = ReferenceDataSet.create(ctx.tenantId, input);
    this.sets.save(set);
    await this.outbox.publish(set.pullEvents());
    this.audit.record(ctx, {
      action: "reference-data.create-set",
      resourceType: "ReferenceDataSet",
      resourceId: set.code,
      after: { code: set.code, name: set.name, entries: set.entries.length },
    });
    return set;
  }

  require(tenantId: TenantId, code: string): ReferenceDataSet {
    const set = this.sets.byCode(tenantId, code.trim().toLowerCase());
    if (!set) throw new NotFoundError("ReferenceDataSet", code);
    return set;
  }

  list(tenantId: TenantId, filter: { status?: string; search?: string } = {}): ReferenceDataSet[] {
    return this.sets.list(tenantId, filter);
  }

  async addEntry(
    ctx: CommandContext,
    setCode: string,
    input: ReferenceEntryInput,
  ): Promise<ReferenceEntry> {
    const set = this.require(ctx.tenantId, setCode);
    const entry = set.addEntry(input);
    this.sets.save(set);
    await this.outbox.publish(set.pullEvents());
    this.audit.record(ctx, {
      action: "reference-data.add-entry",
      resourceType: "ReferenceDataSet",
      resourceId: `${set.code}/${entry.code}`,
      after: entry,
    });
    return entry;
  }

  async updateEntry(
    ctx: CommandContext,
    setCode: string,
    entryCode: string,
    patch: Partial<ReferenceEntryInput>,
  ): Promise<ReferenceEntry> {
    const set = this.require(ctx.tenantId, setCode);
    const before = set.entry(entryCode);
    const entry = set.updateEntry(entryCode, patch);
    this.sets.save(set);
    await this.outbox.publish(set.pullEvents());
    this.audit.record(ctx, {
      action: "reference-data.update-entry",
      resourceType: "ReferenceDataSet",
      resourceId: `${set.code}/${entryCode}`,
      before,
      after: entry,
    });
    return entry;
  }

  async retireEntry(ctx: CommandContext, setCode: string, entryCode: string): Promise<string[]> {
    const set = this.require(ctx.tenantId, setCode);
    const retired = set.retireEntry(entryCode, this.clock.now());
    this.sets.save(set);
    await this.outbox.publish(set.pullEvents());
    this.audit.record(ctx, {
      action: "reference-data.retire-entry",
      resourceType: "ReferenceDataSet",
      resourceId: `${set.code}/${entryCode}`,
      after: { retired },
    });
    return retired;
  }

  /** Bulk replace, used by CSV import; all-or-nothing on validation. */
  async importEntries(
    ctx: CommandContext,
    setCode: string,
    entries: readonly ReferenceEntryInput[],
  ): Promise<ReferenceDataSet> {
    const set = this.require(ctx.tenantId, setCode);
    const before = { entries: set.entries.length, revision: set.revision };
    set.replaceEntries(entries);
    this.sets.save(set);
    this.audit.record(ctx, {
      action: "reference-data.import",
      resourceType: "ReferenceDataSet",
      resourceId: set.code,
      before,
      after: { entries: set.entries.length, revision: set.revision },
    });
    return set;
  }

  async publish(ctx: CommandContext, setCode: string): Promise<ReferenceDataSet> {
    const set = this.require(ctx.tenantId, setCode);
    set.publish(this.clock.now());
    this.sets.save(set);
    await this.outbox.publish(set.pullEvents());
    this.audit.record(ctx, {
      action: "reference-data.publish",
      resourceType: "ReferenceDataSet",
      resourceId: set.code,
      after: { revision: set.revision, entries: set.entries.length },
    });
    return set;
  }

  async deprecate(ctx: CommandContext, setCode: string): Promise<ReferenceDataSet> {
    const set = this.require(ctx.tenantId, setCode);
    set.deprecate();
    this.sets.save(set);
    this.audit.record(ctx, {
      action: "reference-data.deprecate",
      resourceType: "ReferenceDataSet",
      resourceId: set.code,
    });
    return set;
  }

  /** Read path for domain services: published entries live at `at`. */
  resolve(
    tenantId: TenantId,
    setCode: string,
    options: { at?: IsoDateTime; includeInactive?: boolean; publishedOnly?: boolean } = {},
  ): ReferenceEntry[] {
    const set = this.require(tenantId, setCode);
    if (options.publishedOnly !== false && set.status === "draft") return [];
    return set.resolve(options.at ?? this.clock.now(), {
      includeInactive: options.includeInactive,
    });
  }

  lookup(tenantId: TenantId, setCode: string, entryCode: string, at?: IsoDateTime): ReferenceEntry {
    const set = this.require(tenantId, setCode);
    const entry = set.lookup(entryCode, at ?? this.clock.now());
    if (!entry) throw new NotFoundError(`ReferenceEntry(${setCode})`, entryCode);
    return entry;
  }

  tree(tenantId: TenantId, setCode: string, at?: IsoDateTime): ReferenceTreeNode[] {
    return this.require(tenantId, setCode).tree(at ?? this.clock.now());
  }

  /** Flat `code → label` map, the shape most callers actually want. */
  labels(tenantId: TenantId, setCode: string, at?: IsoDateTime): Record<string, string> {
    return Object.fromEntries(
      this.resolve(tenantId, setCode, { at, publishedOnly: false }).map((entry) => [
        entry.code,
        entry.label,
      ]),
    );
  }
}

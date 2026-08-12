import {
  ConflictError,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { todayUtc } from "../domain/calendar.js";
import {
  CodeList,
  diffVersions,
  type CodeListDiffEntry,
  type CodeListEntry,
  type CodeListEntryInput,
  type CodeListVersion,
  type CreateCodeListInput,
} from "../domain/code-list.js";
import { CodeListError } from "../domain/errors.js";
import type { Clock, CodeListRepository, OutboxPort } from "./ports.js";

export interface CodeListSummary {
  readonly id: Ulid;
  readonly listCode: string;
  readonly name: string;
  readonly steward?: string;
  readonly hierarchical: boolean;
  readonly allowsCustomCodes: boolean;
  readonly versionCount: number;
  readonly currentVersion?: number;
  readonly currentEntryCount: number;
  readonly hasOpenDraft: boolean;
}

export interface CodeResolution {
  readonly listCode: string;
  readonly version: number;
  readonly entry: CodeListEntry;
  readonly path: readonly string[];
}

/**
 * Code list governance.
 *
 * Reads always resolve "as of" a date so a document keeps rendering the labels
 * that were current when it was raised. Writes flow through the draft →
 * publish cycle on the aggregate; this service adds tenant uniqueness, the
 * clock and event publication.
 */
export class CodeListService {
  constructor(
    private readonly lists: CodeListRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, input: CreateCodeListInput): Promise<CodeList> {
    const listCode = input.listCode.trim().toLowerCase();
    if (await this.lists.byCode(ctx.tenantId, listCode)) {
      throw new ConflictError(`Code list "${listCode}" already exists`);
    }
    const list = CodeList.create(ctx.tenantId, input);
    await this.commit(list);
    return list;
  }

  async get(ctx: TenantContext, listCode: string): Promise<CodeList> {
    const list = await this.lists.byCode(ctx.tenantId, listCode.trim().toLowerCase());
    if (!list) throw new NotFoundError("CodeList", listCode);
    return list;
  }

  async list(ctx: TenantContext): Promise<readonly CodeListSummary[]> {
    const today = String(todayUtc());
    return (await this.lists.all(ctx.tenantId))
      .map((list) => {
        const current = list.versionAt(today);
        return {
          id: list.id,
          listCode: list.listCode,
          name: list.name,
          steward: list.steward,
          hierarchical: list.hierarchical,
          allowsCustomCodes: list.allowsCustomCodes,
          versionCount: list.versions.length,
          currentVersion: current?.version,
          currentEntryCount: current?.entries.filter((entry) => !entry.deprecated).length ?? 0,
          hasOpenDraft: list.draft() !== undefined,
        };
      })
      .sort((a, b) => a.listCode.localeCompare(b.listCode));
  }

  async draftNewVersion(ctx: TenantContext, listCode: string, notes?: string): Promise<CodeListVersion> {
    const list = await this.get(ctx, listCode);
    const version = list.draftNewVersion(notes);
    await this.commit(list);
    return version;
  }

  async upsertEntry(
    ctx: TenantContext,
    listCode: string,
    entry: CodeListEntryInput,
  ): Promise<CodeListEntry> {
    const list = await this.get(ctx, listCode);
    const saved = list.upsertEntry(entry);
    await this.commit(list);
    return saved;
  }

  async upsertEntries(
    ctx: TenantContext,
    listCode: string,
    entries: readonly CodeListEntryInput[],
  ): Promise<readonly CodeListEntry[]> {
    const list = await this.get(ctx, listCode);
    // Parents must exist before children, so seed in the given order.
    const saved = entries.map((entry) => list.upsertEntry(entry));
    await this.commit(list);
    return saved;
  }

  async removeDraftEntry(ctx: TenantContext, listCode: string, code: string): Promise<void> {
    const list = await this.get(ctx, listCode);
    list.removeDraftEntry(code);
    await this.commit(list);
  }

  async deprecateEntry(
    ctx: TenantContext,
    listCode: string,
    version: number,
    code: string,
    options: { readonly reason?: string; readonly replacedBy?: string } = {},
  ): Promise<CodeListEntry> {
    const list = await this.get(ctx, listCode);
    const entry = list.deprecateEntry(version, code, options);
    await this.commit(list);
    return entry;
  }

  async publish(
    ctx: TenantContext,
    listCode: string,
    effectiveFrom: string,
  ): Promise<CodeListVersion> {
    const list = await this.get(ctx, listCode);
    const version = list.publishDraft(effectiveFrom, ctx.userId, this.clock.now());
    await this.commit(list);
    return version;
  }

  async retireVersion(
    ctx: TenantContext,
    listCode: string,
    version: number,
    effectiveTo: string,
  ): Promise<CodeListVersion> {
    const list = await this.get(ctx, listCode);
    const retired = list.retireVersion(version, effectiveTo);
    await this.commit(list);
    return retired;
  }

  async discardDraft(ctx: TenantContext, listCode: string): Promise<void> {
    const list = await this.get(ctx, listCode);
    list.discardDraft();
    await this.commit(list);
  }

  async entries(
    ctx: TenantContext,
    listCode: string,
    options: { readonly asOf?: string; readonly includeDeprecated?: boolean; readonly parentCode?: string } = {},
  ): Promise<readonly CodeListEntry[]> {
    const list = await this.get(ctx, listCode);
    const asOf = options.asOf ?? this.clock.now();
    const entries = list.entriesAt(asOf, { includeDeprecated: options.includeDeprecated });
    if (!options.parentCode) return entries;
    const parent = options.parentCode.trim().toUpperCase();
    return entries.filter((entry) => entry.parentCode === parent);
  }

  /** Resolves a code, returning its ancestry path for hierarchical lists. */
  async resolve(
    ctx: TenantContext,
    listCode: string,
    code: string,
    asOf?: string,
  ): Promise<CodeResolution> {
    const list = await this.get(ctx, listCode);
    const at = asOf ?? this.clock.now();
    const version = list.versionAt(at);
    if (!version) {
      throw new CodeListError(`Code list ${list.listCode} has no version effective on ${at}`);
    }
    const entry = list.requireUsable(code, at);
    return {
      listCode: list.listCode,
      version: version.version,
      entry,
      path: [...list.ancestorsOf(entry.code, at).map((a) => a.code), entry.code],
    };
  }

  /** Validates a code without materializing the entry; used by other services. */
  async validateCode(
    ctx: TenantContext,
    listCode: string,
    code: string,
    asOf?: string,
  ): Promise<CodeListEntry> {
    const list = await this.get(ctx, listCode);
    return list.requireUsable(code, asOf ?? this.clock.now());
  }

  async descendants(
    ctx: TenantContext,
    listCode: string,
    code: string,
    asOf?: string,
  ): Promise<readonly CodeListEntry[]> {
    const list = await this.get(ctx, listCode);
    return list.descendantsOf(code, asOf ?? this.clock.now());
  }

  /** Maps a code across versions, following deprecation successors. */
  async translate(
    ctx: TenantContext,
    listCode: string,
    code: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<{ readonly from: string; readonly to?: string; readonly translated: boolean }> {
    const list = await this.get(ctx, listCode);
    const to = list.translate(code, fromVersion, toVersion);
    return { from: code.trim().toUpperCase(), to, translated: to !== undefined };
  }

  async diff(
    ctx: TenantContext,
    listCode: string,
    fromVersion: number,
    toVersion: number,
  ): Promise<readonly CodeListDiffEntry[]> {
    const list = await this.get(ctx, listCode);
    return diffVersions(list.versionNumbered(fromVersion), list.versionNumbered(toVersion));
  }

  private async commit(list: CodeList): Promise<void> {
    await this.lists.save(list);
    const events = list.pullEvents();
    if (events.length > 0) await this.outbox.publish(events);
  }
}

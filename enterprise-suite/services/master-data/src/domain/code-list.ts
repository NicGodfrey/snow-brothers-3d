import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import { compareDates, dateOf, isoDate, type IsoDate } from "./calendar.js";
import { CodeListError, InvalidStateError, ValidationError } from "./errors.js";
import { MdmEventTypes } from "./events.js";

/**
 * Versioned code lists.
 *
 * Controlled vocabularies (industry codes, reason codes, segments, tax
 * categories) change, and the change has to be governed: a document posted
 * last quarter must still resolve the label the code had then, while new
 * documents use the current list.
 *
 * The model is therefore versioned rather than mutable. Editing happens on a
 * draft version; publishing fixes it to an effective date and closes the
 * previous version at the same instant, so exactly one version is effective at
 * any moment. Published entries are never deleted — they are deprecated, with
 * an optional successor code, which lets `translate` migrate a historical code
 * forward instead of failing.
 */

export type CodeListVersionStatus = "draft" | "published" | "retired";

export type CodeAttributeValue = string | number | boolean;

export interface CodeListEntry {
  readonly code: string;
  readonly label: string;
  readonly description?: string;
  /** Parent entry code, for hierarchical lists such as NAICS or UNSPSC. */
  readonly parentCode?: string;
  readonly sortOrder: number;
  readonly attributes: Readonly<Record<string, CodeAttributeValue>>;
  readonly deprecated: boolean;
  readonly deprecatedReason?: string;
  /** Successor code, followed by `translate` when migrating documents. */
  readonly replacedBy?: string;
}

export interface CodeListVersion {
  readonly version: number;
  readonly status: CodeListVersionStatus;
  readonly entries: readonly CodeListEntry[];
  readonly effectiveFrom?: IsoDate;
  readonly effectiveTo?: IsoDate;
  readonly publishedAt?: IsoDateTime;
  readonly publishedBy?: UserId;
  readonly notes?: string;
}

export interface CodeListProps {
  listCode: string;
  name: string;
  description?: string;
  /** Team accountable for the vocabulary; shown in governance reports. */
  steward?: string;
  /** When false, only the listed codes are accepted anywhere they are used. */
  allowsCustomCodes: boolean;
  hierarchical: boolean;
  versions: CodeListVersion[];
}

export interface CreateCodeListInput {
  readonly listCode: string;
  readonly name: string;
  readonly description?: string;
  readonly steward?: string;
  readonly allowsCustomCodes?: boolean;
  readonly hierarchical?: boolean;
}

export interface CodeListEntryInput {
  readonly code: string;
  readonly label: string;
  readonly description?: string;
  readonly parentCode?: string;
  readonly sortOrder?: number;
  readonly attributes?: Readonly<Record<string, CodeAttributeValue>>;
}

export const CODE_LIST_CODE_PATTERN = /^[a-z][a-z0-9_.-]{1,47}$/;
export const CODE_ENTRY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;

function normalizeEntryCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!CODE_ENTRY_PATTERN.test(normalized)) {
    throw ValidationError.single("code", `invalid code list entry code "${value}"`);
  }
  return normalized;
}

export class CodeList extends AggregateRoot<CodeListProps> {
  static create(tenantId: TenantId, input: CreateCodeListInput): CodeList {
    const listCode = input.listCode.trim().toLowerCase();
    if (!CODE_LIST_CODE_PATTERN.test(listCode)) {
      throw ValidationError.single("listCode", `invalid code list code "${input.listCode}"`);
    }
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    const list = new CodeList(tenantId, {
      listCode,
      name: input.name.trim(),
      description: input.description?.trim(),
      steward: input.steward?.trim(),
      allowsCustomCodes: input.allowsCustomCodes ?? false,
      hierarchical: input.hierarchical ?? false,
      versions: [{ version: 1, status: "draft", entries: [] }],
    });
    list.raise(
      envelope({
        eventType: MdmEventTypes.CodeListCreated,
        aggregateType: "CodeList",
        aggregateId: list.id,
        tenantId,
        payload: { codeListId: list.id, listCode, name: list.props.name, version: 1, entryCount: 0 },
      }),
    );
    return list;
  }

  static fromSnapshot(snapshot: EntityProps & CodeListProps): CodeList {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new CodeList(
      tenantId,
      { ...props, versions: props.versions.map((v) => ({ ...v, entries: [...v.entries] })) },
      { id, createdAt, updatedAt, version },
    );
  }

  // --- accessors -------------------------------------------------------------

  get listCode(): string {
    return this.props.listCode;
  }
  get name(): string {
    return this.props.name;
  }
  get steward(): string | undefined {
    return this.props.steward;
  }
  get allowsCustomCodes(): boolean {
    return this.props.allowsCustomCodes;
  }
  get hierarchical(): boolean {
    return this.props.hierarchical;
  }
  get versions(): readonly CodeListVersion[] {
    return this.props.versions;
  }

  versionNumbered(version: number): CodeListVersion {
    const found = this.props.versions.find((v) => v.version === version);
    if (!found) throw new CodeListError(`${this.props.listCode} has no version ${version}`);
    return found;
  }

  /** The single open draft, if one exists. */
  draft(): CodeListVersion | undefined {
    return this.props.versions.find((v) => v.status === "draft");
  }

  latestPublished(): CodeListVersion | undefined {
    return [...this.props.versions]
      .filter((v) => v.status === "published")
      .sort((a, b) => b.version - a.version)[0];
  }

  /** The version effective on a date, ignoring drafts. */
  versionAt(on: string): CodeListVersion | undefined {
    const at = isoDate(on.slice(0, 10));
    return this.props.versions
      .filter((v) => v.status !== "draft" && v.effectiveFrom !== undefined)
      .filter(
        (v) =>
          compareDates(at, v.effectiveFrom!) >= 0 &&
          (v.effectiveTo === undefined || compareDates(at, v.effectiveTo) < 0),
      )
      .sort((a, b) => b.version - a.version)[0];
  }

  entriesAt(on: string, options: { readonly includeDeprecated?: boolean } = {}): readonly CodeListEntry[] {
    const version = this.versionAt(on);
    if (!version) return [];
    return version.entries
      .filter((entry) => options.includeDeprecated === true || !entry.deprecated)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
  }

  /** Resolves a code on a date, or undefined when it is unknown then. */
  lookup(code: string, on: string): CodeListEntry | undefined {
    const version = this.versionAt(on);
    if (!version) return undefined;
    const normalized = code.trim().toUpperCase();
    return version.entries.find((entry) => entry.code === normalized);
  }

  /** Throws unless the code exists, is effective and is not deprecated. */
  requireUsable(code: string, on: string): CodeListEntry {
    const version = this.versionAt(on);
    if (!version) {
      throw new CodeListError(`Code list ${this.props.listCode} has no version effective on ${on}`, {
        listCode: this.props.listCode,
        on,
      });
    }
    const entry = this.lookup(code, on);
    if (!entry) {
      if (this.props.allowsCustomCodes) {
        return {
          code: code.trim().toUpperCase(),
          label: code.trim(),
          sortOrder: Number.MAX_SAFE_INTEGER,
          attributes: {},
          deprecated: false,
        };
      }
      throw new CodeListError(
        `"${code}" is not in ${this.props.listCode} v${version.version} (effective ${on})`,
        { listCode: this.props.listCode, code, version: version.version },
      );
    }
    if (entry.deprecated) {
      throw new CodeListError(
        `"${entry.code}" is deprecated in ${this.props.listCode}${
          entry.replacedBy ? `; use "${entry.replacedBy}"` : ""
        }`,
        { listCode: this.props.listCode, code: entry.code, replacedBy: entry.replacedBy },
      );
    }
    return entry;
  }

  /** Root-to-entry path for a hierarchical list. */
  ancestorsOf(code: string, on: string): readonly CodeListEntry[] {
    const version = this.versionAt(on);
    if (!version) return [];
    const byCode = new Map(version.entries.map((entry) => [entry.code, entry]));
    const path: CodeListEntry[] = [];
    let cursor = byCode.get(code.trim().toUpperCase());
    const guard = new Set<string>();
    while (cursor?.parentCode) {
      if (guard.has(cursor.code)) break;
      guard.add(cursor.code);
      const parent = byCode.get(cursor.parentCode);
      if (!parent) break;
      path.unshift(parent);
      cursor = parent;
    }
    return path;
  }

  descendantsOf(code: string, on: string): readonly CodeListEntry[] {
    const version = this.versionAt(on);
    if (!version) return [];
    const root = code.trim().toUpperCase();
    const children = new Map<string, CodeListEntry[]>();
    for (const entry of version.entries) {
      if (!entry.parentCode) continue;
      const bucket = children.get(entry.parentCode) ?? [];
      bucket.push(entry);
      children.set(entry.parentCode, bucket);
    }
    const collected: CodeListEntry[] = [];
    const queue = [...(children.get(root) ?? [])];
    while (queue.length > 0) {
      const entry = queue.shift()!;
      if (collected.some((seen) => seen.code === entry.code)) continue;
      collected.push(entry);
      queue.push(...(children.get(entry.code) ?? []));
    }
    return collected;
  }

  /**
   * Maps a code from one version to another, following deprecation
   * successors. Returns undefined when the code has no equivalent, which the
   * caller should surface as a data-quality exception rather than a silent
   * drop.
   */
  translate(code: string, fromVersion: number, toVersion: number): string | undefined {
    const source = this.versionNumbered(fromVersion);
    const target = this.versionNumbered(toVersion);
    const targetCodes = new Set(target.entries.filter((e) => !e.deprecated).map((e) => e.code));
    let cursor = code.trim().toUpperCase();
    const visited = new Set<string>();
    for (let hops = 0; hops < 16; hops += 1) {
      if (targetCodes.has(cursor)) return cursor;
      if (visited.has(cursor)) return undefined;
      visited.add(cursor);
      const successor =
        target.entries.find((e) => e.code === cursor)?.replacedBy ??
        source.entries.find((e) => e.code === cursor)?.replacedBy;
      if (!successor) return undefined;
      cursor = successor.toUpperCase();
    }
    return undefined;
  }

  // --- commands --------------------------------------------------------------

  updateMetadata(patch: {
    readonly name?: string;
    readonly description?: string | null;
    readonly steward?: string | null;
    readonly allowsCustomCodes?: boolean;
  }): void {
    if (patch.name !== undefined) {
      if (patch.name.trim().length === 0) throw ValidationError.single("name", "name cannot be blank");
      this.props.name = patch.name.trim();
    }
    if (patch.description !== undefined) this.props.description = patch.description ?? undefined;
    if (patch.steward !== undefined) this.props.steward = patch.steward ?? undefined;
    if (patch.allowsCustomCodes !== undefined) this.props.allowsCustomCodes = patch.allowsCustomCodes;
    this.touch();
  }

  /** Opens a new draft seeded from the latest published version's entries. */
  draftNewVersion(notes?: string): CodeListVersion {
    if (this.draft()) {
      throw new InvalidStateError(
        `${this.props.listCode} already has draft v${this.draft()!.version}; publish or discard it first`,
      );
    }
    const source = this.latestPublished();
    const version: CodeListVersion = {
      version: Math.max(...this.props.versions.map((v) => v.version)) + 1,
      status: "draft",
      entries: source ? source.entries.map((entry) => ({ ...entry })) : [],
      notes: notes?.trim(),
    };
    this.props.versions.push(version);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CodeListVersionDrafted,
        aggregateType: "CodeList",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          codeListId: this.id,
          listCode: this.props.listCode,
          version: version.version,
          entryCount: version.entries.length,
        },
      }),
    );
    return version;
  }

  private requireDraft(): CodeListVersion {
    const draft = this.draft();
    if (!draft) {
      throw new InvalidStateError(
        `${this.props.listCode} has no open draft; call draftNewVersion() before editing`,
      );
    }
    return draft;
  }

  private replaceVersion(version: CodeListVersion, next: CodeListVersion): void {
    const index = this.props.versions.findIndex((v) => v.version === version.version);
    this.props.versions[index] = next;
    this.touch();
  }

  /** Adds or replaces an entry in the open draft. */
  upsertEntry(input: CodeListEntryInput): CodeListEntry {
    const draft = this.requireDraft();
    const code = normalizeEntryCode(input.code);
    if (input.label.trim().length === 0) {
      throw ValidationError.single("label", "label is required");
    }
    const parentCode = input.parentCode ? normalizeEntryCode(input.parentCode) : undefined;
    if (parentCode) {
      if (!this.props.hierarchical) {
        throw new InvalidStateError(`${this.props.listCode} is a flat list and has no parent codes`);
      }
      if (parentCode === code) {
        throw new InvalidStateError(`Entry ${code} cannot be its own parent`);
      }
      if (!draft.entries.some((entry) => entry.code === parentCode)) {
        throw new CodeListError(`Parent code "${parentCode}" is not in draft v${draft.version}`);
      }
      assertNoCycle(draft.entries, code, parentCode);
    }
    const existing = draft.entries.find((entry) => entry.code === code);
    const entry: CodeListEntry = {
      code,
      label: input.label.trim(),
      description: input.description?.trim(),
      parentCode,
      sortOrder: input.sortOrder ?? existing?.sortOrder ?? draft.entries.length + 1,
      attributes: { ...(input.attributes ?? existing?.attributes ?? {}) },
      deprecated: existing?.deprecated ?? false,
      deprecatedReason: existing?.deprecatedReason,
      replacedBy: existing?.replacedBy,
    };
    const entries = existing
      ? draft.entries.map((current) => (current.code === code ? entry : current))
      : [...draft.entries, entry];
    this.replaceVersion(draft, { ...draft, entries });
    return entry;
  }

  /** Removes an entry from the draft. Published entries are deprecated instead. */
  removeDraftEntry(code: string): void {
    const draft = this.requireDraft();
    const normalized = normalizeEntryCode(code);
    if (!draft.entries.some((entry) => entry.code === normalized)) {
      throw new CodeListError(`"${normalized}" is not in draft v${draft.version}`);
    }
    const orphans = draft.entries.filter((entry) => entry.parentCode === normalized);
    if (orphans.length > 0) {
      throw new InvalidStateError(
        `"${normalized}" still parents [${orphans.map((o) => o.code).join(", ")}]`,
      );
    }
    this.replaceVersion(draft, {
      ...draft,
      entries: draft.entries.filter((entry) => entry.code !== normalized),
    });
  }

  /**
   * Retires a code without removing it. Works on the draft or on a published
   * version, because withdrawing a code is additive information that must
   * reach consumers immediately.
   */
  deprecateEntry(
    version: number,
    code: string,
    options: { readonly reason?: string; readonly replacedBy?: string } = {},
  ): CodeListEntry {
    const target = this.versionNumbered(version);
    if (target.status === "retired") {
      throw new InvalidStateError(`Version ${version} of ${this.props.listCode} is retired`);
    }
    const normalized = normalizeEntryCode(code);
    const entry = target.entries.find((e) => e.code === normalized);
    if (!entry) throw new CodeListError(`"${normalized}" is not in v${version}`);
    if (entry.deprecated) {
      throw new InvalidStateError(`"${normalized}" is already deprecated in v${version}`);
    }
    const replacedBy = options.replacedBy ? normalizeEntryCode(options.replacedBy) : undefined;
    if (replacedBy) {
      const successor = target.entries.find((e) => e.code === replacedBy);
      if (!successor) throw new CodeListError(`Successor "${replacedBy}" is not in v${version}`);
      if (successor.deprecated) {
        throw new InvalidStateError(`Successor "${replacedBy}" is itself deprecated`);
      }
    }
    const updated: CodeListEntry = {
      ...entry,
      deprecated: true,
      deprecatedReason: options.reason?.trim(),
      replacedBy,
    };
    this.replaceVersion(target, {
      ...target,
      entries: target.entries.map((e) => (e.code === normalized ? updated : e)),
    });
    this.raise(
      envelope({
        eventType: MdmEventTypes.CodeListEntryDeprecated,
        aggregateType: "CodeList",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          codeListId: this.id,
          listCode: this.props.listCode,
          version,
          entryCode: normalized,
          replacedBy,
        },
      }),
    );
    return updated;
  }

  /**
   * Publishes the draft from an effective date, closing the version that was
   * effective until then so the timeline stays gap-free and non-overlapping.
   */
  publishDraft(effectiveFrom: string, actor: UserId, at: IsoDateTime): CodeListVersion {
    const draft = this.requireDraft();
    if (draft.entries.length === 0) {
      throw new InvalidStateError(`Cannot publish an empty version of ${this.props.listCode}`);
    }
    const from = isoDate(effectiveFrom.slice(0, 10));
    const previous = this.latestPublished();
    if (previous?.effectiveFrom && compareDates(from, previous.effectiveFrom) <= 0) {
      throw new InvalidStateError(
        `v${draft.version} must take effect after v${previous.version} (${previous.effectiveFrom})`,
      );
    }
    const activeEntries = draft.entries.filter((entry) => !entry.deprecated);
    if (activeEntries.length === 0) {
      throw new InvalidStateError(
        `Every entry in ${this.props.listCode} v${draft.version} is deprecated; nothing to publish`,
      );
    }
    if (previous) {
      this.replaceVersion(previous, { ...previous, effectiveTo: from });
    }
    const published: CodeListVersion = {
      ...draft,
      status: "published",
      effectiveFrom: from,
      publishedAt: at,
      publishedBy: actor,
    };
    this.replaceVersion(draft, published);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CodeListVersionPublished,
        aggregateType: "CodeList",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          codeListId: this.id,
          listCode: this.props.listCode,
          version: published.version,
          entryCount: published.entries.length,
          effectiveFrom: from,
          effectiveTo: published.effectiveTo,
        },
      }),
    );
    return published;
  }

  /** Ends a published version without a successor, closing the list out. */
  retireVersion(version: number, effectiveTo: string): CodeListVersion {
    const target = this.versionNumbered(version);
    if (target.status !== "published") {
      throw new InvalidStateError(`Only a published version can be retired; v${version} is ${target.status}`);
    }
    const to = isoDate(effectiveTo.slice(0, 10));
    if (target.effectiveFrom && compareDates(to, target.effectiveFrom) <= 0) {
      throw new InvalidStateError(`Retirement date must be after ${target.effectiveFrom}`);
    }
    const retired: CodeListVersion = { ...target, status: "retired", effectiveTo: to };
    this.replaceVersion(target, retired);
    this.raise(
      envelope({
        eventType: MdmEventTypes.CodeListVersionRetired,
        aggregateType: "CodeList",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          codeListId: this.id,
          listCode: this.props.listCode,
          version,
          entryCount: target.entries.length,
          effectiveTo: to,
        },
      }),
    );
    return retired;
  }

  discardDraft(): void {
    const draft = this.requireDraft();
    if (this.props.versions.length === 1) {
      throw new InvalidStateError(`${this.props.listCode} has only its initial draft; nothing to fall back to`);
    }
    this.props.versions = this.props.versions.filter((v) => v.version !== draft.version);
    this.touch();
  }
}

export interface CodeListDiffEntry {
  readonly code: string;
  readonly change: "added" | "removed" | "relabelled" | "deprecated" | "reparented";
  readonly before?: string;
  readonly after?: string;
}

/** Structural diff between two versions, used in change-approval reviews. */
export function diffVersions(
  from: CodeListVersion,
  to: CodeListVersion,
): readonly CodeListDiffEntry[] {
  const before = new Map(from.entries.map((entry) => [entry.code, entry]));
  const after = new Map(to.entries.map((entry) => [entry.code, entry]));
  const changes: CodeListDiffEntry[] = [];

  for (const [code, entry] of after) {
    const previous = before.get(code);
    if (!previous) {
      changes.push({ code, change: "added", after: entry.label });
      continue;
    }
    if (previous.label !== entry.label) {
      changes.push({ code, change: "relabelled", before: previous.label, after: entry.label });
    }
    if (!previous.deprecated && entry.deprecated) {
      changes.push({ code, change: "deprecated", after: entry.replacedBy });
    }
    if (previous.parentCode !== entry.parentCode) {
      changes.push({
        code,
        change: "reparented",
        before: previous.parentCode,
        after: entry.parentCode,
      });
    }
  }
  for (const [code, entry] of before) {
    if (!after.has(code)) changes.push({ code, change: "removed", before: entry.label });
  }
  return changes.sort((a, b) => a.code.localeCompare(b.code) || a.change.localeCompare(b.change));
}

function assertNoCycle(
  entries: readonly CodeListEntry[],
  code: string,
  parentCode: string,
): void {
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const path = [code];
  let cursor: string | undefined = parentCode;
  while (cursor) {
    if (path.includes(cursor)) {
      throw new InvalidStateError(`Code list hierarchy cycle: ${[...path, cursor].join(" -> ")}`);
    }
    path.push(cursor);
    cursor = byCode.get(cursor)?.parentCode;
  }
}

/** Code lists seeded for every tenant, with their initial entries. */
export interface CodeListSeed {
  readonly listCode: string;
  readonly name: string;
  readonly description?: string;
  readonly hierarchical?: boolean;
  readonly entries: readonly CodeListEntryInput[];
}

export const STANDARD_CODE_LISTS: readonly CodeListSeed[] = [
  {
    listCode: "customer_segment",
    name: "Customer segment",
    description: "Commercial segmentation used for pricing and service levels",
    entries: [
      { code: "STRATEGIC", label: "Strategic account", sortOrder: 1 },
      { code: "KEY", label: "Key account", sortOrder: 2 },
      { code: "VOLUME", label: "Volume account", sortOrder: 3 },
      { code: "LONGTAIL", label: "Long tail", sortOrder: 4 },
    ],
  },
  {
    listCode: "industry",
    name: "Industry",
    description: "Condensed industry taxonomy aligned to NAICS sectors",
    hierarchical: true,
    entries: [
      { code: "MFG", label: "Manufacturing", sortOrder: 1 },
      { code: "MFG.AUTO", label: "Automotive", parentCode: "MFG", sortOrder: 2 },
      { code: "MFG.ELEC", label: "Electronics", parentCode: "MFG", sortOrder: 3 },
      { code: "MFG.FOOD", label: "Food and beverage", parentCode: "MFG", sortOrder: 4 },
      { code: "RETAIL", label: "Retail", sortOrder: 5 },
      { code: "RETAIL.GROC", label: "Grocery", parentCode: "RETAIL", sortOrder: 6 },
      { code: "HEALTH", label: "Healthcare", sortOrder: 7 },
      { code: "PUBLIC", label: "Public sector", sortOrder: 8 },
      { code: "SERVICES", label: "Professional services", sortOrder: 9 },
    ],
  },
  {
    listCode: "tax_category",
    name: "Tax category",
    description: "Tax treatment applied to a customer or site",
    entries: [
      { code: "STANDARD", label: "Standard rated", sortOrder: 1 },
      { code: "REDUCED", label: "Reduced rated", sortOrder: 2 },
      { code: "ZERO", label: "Zero rated", sortOrder: 3 },
      { code: "EXEMPT", label: "Exempt", sortOrder: 4 },
      { code: "REVERSE", label: "Reverse charge", sortOrder: 5 },
    ],
  },
  {
    listCode: "block_reason",
    name: "Customer block reason",
    description: "Why a customer was placed on hold or blocked",
    entries: [
      { code: "CREDIT", label: "Credit limit exceeded", sortOrder: 1 },
      { code: "OVERDUE", label: "Overdue receivables", sortOrder: 2 },
      { code: "SANCTIONS", label: "Sanctions screening hit", sortOrder: 3 },
      { code: "DISPUTE", label: "Commercial dispute", sortOrder: 4 },
      { code: "DATA", label: "Incomplete master data", sortOrder: 5 },
    ],
  },
];

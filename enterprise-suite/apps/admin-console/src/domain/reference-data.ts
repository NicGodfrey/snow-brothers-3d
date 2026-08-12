import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { ImmutableRecordError, InvalidStateError, ValidationError } from "./errors.js";
import { AdminEventTypes } from "./events.js";

/**
 * Reference data: the tenant-editable code lists every domain service reads
 * (order hold reasons, NCR dispositions, shipment incoterms, and so on).
 *
 * Three properties make this more than a key/value bag:
 *   - **Effective dating.** An entry can be scheduled and retired without being
 *     deleted, so historical documents still resolve their codes.
 *   - **Hierarchy.** Entries may nest via `parentCode` (region → country →
 *     site), with cycle and orphan detection at write time.
 *   - **Draft/published.** A set is edited as a draft and published atomically,
 *     so consumers never observe a half-migrated code list.
 */

export const REFERENCE_SET_STATUSES = ["draft", "published", "deprecated"] as const;
export type ReferenceSetStatus = (typeof REFERENCE_SET_STATUSES)[number];

export const SET_CODE_PATTERN = /^[a-z][a-z0-9_.-]{1,62}$/;
export const ENTRY_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,63}$/;

export interface ReferenceEntry {
  readonly code: string;
  readonly label: string;
  readonly description?: string;
  readonly sortOrder: number;
  readonly active: boolean;
  readonly parentCode?: string;
  readonly effectiveFrom?: IsoDateTime;
  readonly effectiveTo?: IsoDateTime;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface ReferenceEntryInput {
  readonly code: string;
  readonly label: string;
  readonly description?: string;
  readonly sortOrder?: number;
  readonly active?: boolean;
  readonly parentCode?: string;
  readonly effectiveFrom?: string;
  readonly effectiveTo?: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface ReferenceDataSetProps {
  code: string;
  name: string;
  description?: string;
  status: ReferenceSetStatus;
  /** Locked sets are owned by the platform and rejected for tenant edits. */
  locked: boolean;
  hierarchical: boolean;
  entries: ReferenceEntry[];
  publishedAt?: IsoDateTime;
  revision: number;
}

export interface CreateReferenceSetInput {
  readonly code: string;
  readonly name: string;
  readonly description?: string;
  readonly hierarchical?: boolean;
  readonly locked?: boolean;
  readonly entries?: readonly ReferenceEntryInput[];
}

export class ReferenceDataSet extends AggregateRoot<ReferenceDataSetProps> {
  static create(
    tenantId: TenantId,
    input: CreateReferenceSetInput,
    existing?: Partial<EntityProps>,
  ): ReferenceDataSet {
    const code = input.code.trim().toLowerCase();
    if (!SET_CODE_PATTERN.test(code)) {
      throw ValidationError.single(
        "code",
        "must be lowercase letters, digits, dot, dash or underscore",
      );
    }
    if (input.name.trim().length === 0) throw ValidationError.single("name", "is required");

    const set = new ReferenceDataSet(
      tenantId,
      {
        code,
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        status: "draft",
        locked: input.locked ?? false,
        hierarchical: input.hierarchical ?? false,
        entries: [],
        revision: 1,
      },
      existing,
    );
    for (const entry of input.entries ?? []) set.addEntry(entry, { silent: true });
    set.raise(
      envelope({
        eventType: AdminEventTypes.referenceSetCreated,
        aggregateType: "ReferenceDataSet",
        aggregateId: set.id,
        tenantId,
        payload: { code, name: set.props.name, entryCount: set.props.entries.length },
      }),
    );
    return set;
  }

  get code(): string {
    return this.props.code;
  }
  get name(): string {
    return this.props.name;
  }
  get status(): ReferenceSetStatus {
    return this.props.status;
  }
  get isLocked(): boolean {
    return this.props.locked;
  }
  get hierarchical(): boolean {
    return this.props.hierarchical;
  }
  get revision(): number {
    return this.props.revision;
  }
  get entries(): readonly ReferenceEntry[] {
    return this.props.entries;
  }

  entry(code: string): ReferenceEntry | undefined {
    return this.props.entries.find((e) => e.code === code);
  }

  addEntry(input: ReferenceEntryInput, options: { silent?: boolean } = {}): ReferenceEntry {
    this.assertEditable();
    const entry = this.normalizeEntry(input);
    if (this.entry(entry.code)) {
      throw new ValidationError(`Entry "${entry.code}" already exists in ${this.props.code}`, [
        { field: "code", message: "must be unique within the set" },
      ]);
    }
    this.assertParent(entry);
    this.props.entries = sortEntries([...this.props.entries, entry]);
    if (!options.silent) {
      this.raise(
        envelope({
          eventType: AdminEventTypes.referenceEntryAdded,
          aggregateType: "ReferenceDataSet",
          aggregateId: this.id,
          tenantId: this.tenantId,
          payload: { set: this.props.code, entry: entry.code, label: entry.label },
        }),
      );
    }
    return entry;
  }

  updateEntry(code: string, patch: Partial<ReferenceEntryInput>): ReferenceEntry {
    this.assertEditable();
    const current = this.entry(code);
    if (!current) {
      throw new InvalidStateError(`Entry "${code}" is not part of set ${this.props.code}`);
    }
    const merged = this.normalizeEntry({
      ...current,
      ...patch,
      code,
      effectiveFrom: patch.effectiveFrom ?? current.effectiveFrom,
      effectiveTo: patch.effectiveTo ?? current.effectiveTo,
      attributes: { ...current.attributes, ...(patch.attributes ?? {}) },
    });
    this.assertParent(merged);
    this.props.entries = sortEntries(
      this.props.entries.map((entry) => (entry.code === code ? merged : entry)),
    );
    this.assertNoCycles();
    this.raise(
      envelope({
        eventType: AdminEventTypes.referenceEntryUpdated,
        aggregateType: "ReferenceDataSet",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { set: this.props.code, entry: code },
      }),
    );
    return merged;
  }

  /**
   * Entries are retired, never removed: documents that reference a code must
   * keep resolving it. Retiring a parent retires its subtree.
   */
  retireEntry(code: string, at: IsoDateTime): string[] {
    this.assertEditable();
    if (!this.entry(code)) {
      throw new InvalidStateError(`Entry "${code}" is not part of set ${this.props.code}`);
    }
    const affected = [code, ...this.descendantsOf(code)];
    this.props.entries = this.props.entries.map((entry) =>
      affected.includes(entry.code) ? { ...entry, active: false, effectiveTo: at } : entry,
    );
    this.raise(
      envelope({
        eventType: AdminEventTypes.referenceEntryRetired,
        aggregateType: "ReferenceDataSet",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { set: this.props.code, entries: affected, retiredAt: at },
      }),
    );
    return affected;
  }

  /** Replaces every entry in one shot; used by CSV/API bulk import. */
  replaceEntries(inputs: readonly ReferenceEntryInput[]): void {
    this.assertEditable();
    const normalized = inputs.map((input) => this.normalizeEntry(input));
    const codes = new Set<string>();
    for (const entry of normalized) {
      if (codes.has(entry.code)) {
        throw ValidationError.single("entries", `duplicate code "${entry.code}"`);
      }
      codes.add(entry.code);
    }
    const previous = this.props.entries;
    this.props.entries = sortEntries(normalized);
    try {
      for (const entry of normalized) this.assertParent(entry);
      this.assertNoCycles();
    } catch (error) {
      this.props.entries = previous;
      throw error;
    }
    this.props.revision += 1;
    this.touch();
  }

  publish(at: IsoDateTime): void {
    if (this.props.locked) throw new ImmutableRecordError("ReferenceDataSet", this.props.code);
    if (this.props.status === "deprecated") {
      throw new InvalidStateError(`Set ${this.props.code} is deprecated`);
    }
    if (this.props.entries.length === 0) {
      throw new InvalidStateError(`Set ${this.props.code} has no entries to publish`);
    }
    this.assertNoCycles();
    this.props.status = "published";
    this.props.publishedAt = at;
    this.props.revision += 1;
    this.raise(
      envelope({
        eventType: AdminEventTypes.referenceSetPublished,
        aggregateType: "ReferenceDataSet",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: {
          set: this.props.code,
          revision: this.props.revision,
          entryCount: this.props.entries.length,
        },
      }),
    );
  }

  deprecate(): void {
    if (this.props.locked) throw new ImmutableRecordError("ReferenceDataSet", this.props.code);
    this.props.status = "deprecated";
    this.touch();
  }

  /** Entries visible to a consumer at a point in time. */
  resolve(at: IsoDateTime, options: { includeInactive?: boolean } = {}): ReferenceEntry[] {
    const instant = Date.parse(at);
    return this.props.entries.filter((entry) => {
      if (!entry.active && !options.includeInactive) return false;
      if (entry.effectiveFrom && Date.parse(entry.effectiveFrom) > instant) return false;
      if (entry.effectiveTo && Date.parse(entry.effectiveTo) <= instant) return false;
      return true;
    });
  }

  lookup(code: string, at: IsoDateTime): ReferenceEntry | undefined {
    return this.resolve(at).find((entry) => entry.code === code);
  }

  /** Depth-first tree view for hierarchical sets. */
  tree(at?: IsoDateTime): ReferenceTreeNode[] {
    const visible = at ? this.resolve(at) : this.props.entries;
    const byParent = new Map<string | undefined, ReferenceEntry[]>();
    for (const entry of visible) {
      const bucket = byParent.get(entry.parentCode) ?? [];
      bucket.push(entry);
      byParent.set(entry.parentCode, bucket);
    }
    const build = (parent: string | undefined): ReferenceTreeNode[] =>
      (byParent.get(parent) ?? []).map((entry) => ({
        entry,
        children: build(entry.code),
      }));
    return build(undefined);
  }

  descendantsOf(code: string): string[] {
    const direct = this.props.entries.filter((entry) => entry.parentCode === code);
    return direct.flatMap((entry) => [entry.code, ...this.descendantsOf(entry.code)]);
  }

  assertEditable(): void {
    if (this.props.locked) throw new ImmutableRecordError("ReferenceDataSet", this.props.code);
    if (this.props.status === "deprecated") {
      throw new InvalidStateError(`Set ${this.props.code} is deprecated and read-only`);
    }
  }

  private normalizeEntry(input: ReferenceEntryInput): ReferenceEntry {
    const code = input.code.trim();
    if (!ENTRY_CODE_PATTERN.test(code)) {
      throw ValidationError.single("entries.code", `"${input.code}" is not a valid entry code`);
    }
    if (input.label.trim().length === 0) {
      throw ValidationError.single("entries.label", "is required");
    }
    const from = input.effectiveFrom ? assertIso("effectiveFrom", input.effectiveFrom) : undefined;
    const to = input.effectiveTo ? assertIso("effectiveTo", input.effectiveTo) : undefined;
    if (from && to && Date.parse(to) <= Date.parse(from)) {
      throw ValidationError.single("entries.effectiveTo", "must be after effectiveFrom");
    }
    if (input.parentCode !== undefined && !this.props.hierarchical) {
      throw ValidationError.single("entries.parentCode", `set ${this.props.code} is not hierarchical`);
    }
    return {
      code,
      label: input.label.trim(),
      description: input.description?.trim() || undefined,
      sortOrder: input.sortOrder ?? 0,
      active: input.active ?? true,
      parentCode: input.parentCode?.trim() || undefined,
      effectiveFrom: from,
      effectiveTo: to,
      attributes: { ...(input.attributes ?? {}) },
    };
  }

  private assertParent(entry: ReferenceEntry): void {
    if (!entry.parentCode) return;
    if (entry.parentCode === entry.code) {
      throw ValidationError.single("entries.parentCode", "an entry cannot be its own parent");
    }
    if (!this.entry(entry.parentCode)) {
      throw ValidationError.single(
        "entries.parentCode",
        `parent "${entry.parentCode}" does not exist in ${this.props.code}`,
      );
    }
  }

  private assertNoCycles(): void {
    const parents = new Map(this.props.entries.map((entry) => [entry.code, entry.parentCode]));
    for (const start of parents.keys()) {
      const chain: string[] = [start];
      let cursor = parents.get(start);
      while (cursor) {
        if (chain.includes(cursor)) {
          throw new InvalidStateError(
            `Reference hierarchy cycle in ${this.props.code}: ${[...chain, cursor].join(" -> ")}`,
          );
        }
        chain.push(cursor);
        cursor = parents.get(cursor);
      }
    }
  }
}

export interface ReferenceTreeNode {
  readonly entry: ReferenceEntry;
  readonly children: ReferenceTreeNode[];
}

function sortEntries(entries: readonly ReferenceEntry[]): ReferenceEntry[] {
  return [...entries].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
}

function assertIso(field: string, value: string): IsoDateTime {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw ValidationError.single(`entries.${field}`, `"${value}" is not an ISO timestamp`);
  }
  return new Date(parsed).toISOString() as IsoDateTime;
}

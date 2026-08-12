/**
 * Dimensions and their hierarchies.
 *
 * Facts store leaf-level keys (a SKU, a warehouse, a lead source). A
 * dimension turns those into something a report can group by at any level:
 *
 *   product:  family -> category -> sku
 *   geo:      region -> country -> site
 *
 * Grouping by `product.category` therefore does not need the fact to carry a
 * category column — the aggregation engine rolls the SKU up through the
 * member's parent chain. That is what keeps ingest cheap (write the key you
 * have) while keeping queries expressive (read the level you want).
 *
 * Members are slowly-changing type 1 here: re-registering a member replaces
 * its label/parent. Historical re-parenting (type 2) would need an effective
 * date on the member row; the SQL schema leaves room for it.
 */
import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { DefinitionError } from "./errors.js";
import { ReportingEventTypes } from "./events.js";

export type DimensionType = "categorical" | "entity" | "geo" | "time" | "flag";

export const DIMENSION_TYPES: readonly DimensionType[] = [
  "categorical",
  "entity",
  "geo",
  "time",
  "flag",
];

export interface HierarchyLevel {
  readonly key: string;
  readonly label: string;
  /** 0 is the top of the hierarchy; the deepest level is the fact grain. */
  readonly depth: number;
}

export interface DimensionMember {
  readonly key: string;
  readonly label: string;
  readonly levelKey: string;
  readonly parentKey?: string;
  readonly attributes: Readonly<Record<string, string>>;
}

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export function assertDimensionKey(key: string): string {
  if (!KEY_PATTERN.test(key)) {
    throw new DefinitionError(
      `dimension key '${key}' must be snake_case, start with a letter, and be 2..64 characters`,
    );
  }
  return key;
}

/**
 * A grouping target: either a bare dimension (`product`, meaning its leaf
 * level) or a level within it (`product.category`).
 */
export interface DimensionRef {
  readonly dimensionKey: string;
  readonly levelKey?: string;
}

export function parseDimensionRef(ref: string): DimensionRef {
  const [dimensionKey, levelKey, ...rest] = ref.split(".");
  if (!dimensionKey || rest.length > 0) {
    throw new DefinitionError(`invalid dimension reference '${ref}' (expected 'dim' or 'dim.level')`);
  }
  return { dimensionKey, levelKey };
}

export function formatDimensionRef(ref: DimensionRef): string {
  return ref.levelKey ? `${ref.dimensionKey}.${ref.levelKey}` : ref.dimensionKey;
}

interface DimensionProps {
  key: string;
  label: string;
  description?: string;
  type: DimensionType;
  levels: HierarchyLevel[];
  members: Map<string, DimensionMember>;
}

export interface DefineDimensionInput {
  key: string;
  label: string;
  type?: DimensionType;
  description?: string;
  /** Ordered top-down; defaults to a single level named after the key. */
  levels?: readonly { key: string; label: string }[];
}

export class Dimension extends AggregateRoot<DimensionProps> {
  private constructor(tenantId: TenantId, props: DimensionProps, existing?: Partial<EntityProps>) {
    super(tenantId, props, existing);
  }

  static define(tenantId: TenantId, input: DefineDimensionInput): Dimension {
    const key = assertDimensionKey(input.key);
    if (!input.label.trim()) throw new DefinitionError(`dimension '${key}' needs a label`);

    const declared = input.levels?.length ? input.levels : [{ key, label: input.label }];
    const seen = new Set<string>();
    const levels: HierarchyLevel[] = declared.map((level, depth) => {
      if (!KEY_PATTERN.test(level.key)) {
        throw new DefinitionError(`dimension '${key}' has invalid level key '${level.key}'`);
      }
      if (seen.has(level.key)) {
        throw new DefinitionError(`dimension '${key}' declares level '${level.key}' twice`);
      }
      seen.add(level.key);
      return { key: level.key, label: level.label, depth };
    });

    const dimension = new Dimension(tenantId, {
      key,
      label: input.label.trim(),
      description: input.description?.trim(),
      type: input.type ?? "categorical",
      levels,
      members: new Map(),
    });
    dimension.raise(
      envelope({
        eventType: ReportingEventTypes.DimensionRegistered,
        aggregateType: "Dimension",
        aggregateId: dimension.id,
        tenantId,
        payload: { key, levels: levels.map((l) => l.key), type: dimension.props.type },
      }),
    );
    return dimension;
  }

  static rehydrate(
    tenantId: TenantId,
    props: DimensionProps,
    existing: Partial<EntityProps>,
  ): Dimension {
    return new Dimension(tenantId, props, existing);
  }

  get key(): string { return this.props.key; }
  get label(): string { return this.props.label; }
  get description(): string | undefined { return this.props.description; }
  get type(): DimensionType { return this.props.type; }
  get levels(): readonly HierarchyLevel[] { return this.props.levels; }
  get memberCount(): number { return this.props.members.size; }

  /** The grain level facts are keyed by. */
  get leafLevel(): HierarchyLevel {
    return this.props.levels[this.props.levels.length - 1]!;
  }

  level(levelKey: string): HierarchyLevel | undefined {
    return this.props.levels.find((l) => l.key === levelKey);
  }

  hasLevel(levelKey: string): boolean {
    return this.level(levelKey) !== undefined;
  }

  member(memberKey: string): DimensionMember | undefined {
    return this.props.members.get(memberKey);
  }

  members(levelKey?: string): DimensionMember[] {
    const all = [...this.props.members.values()];
    return levelKey ? all.filter((m) => m.levelKey === levelKey) : all;
  }

  upsertMember(input: {
    key: string;
    label: string;
    levelKey?: string;
    parentKey?: string;
    attributes?: Readonly<Record<string, string>>;
  }): DimensionMember {
    if (!input.key.trim()) throw new DefinitionError("dimension member key is required");
    const levelKey = input.levelKey ?? this.leafLevel.key;
    const level = this.level(levelKey);
    if (!level) {
      throw new DefinitionError(
        `dimension '${this.props.key}' has no level '${levelKey}' (levels: ${this.props.levels
          .map((l) => l.key)
          .join(", ")})`,
      );
    }
    if (input.parentKey !== undefined) {
      if (level.depth === 0) {
        throw new DefinitionError(
          `member '${input.key}' is at the top level '${levelKey}' and cannot have a parent`,
        );
      }
      const parent = this.props.members.get(input.parentKey);
      if (!parent) {
        throw new DefinitionError(
          `parent member '${input.parentKey}' must be registered before '${input.key}'`,
        );
      }
      const parentLevel = this.level(parent.levelKey);
      if (!parentLevel || parentLevel.depth !== level.depth - 1) {
        throw new DefinitionError(
          `parent '${input.parentKey}' is at level '${parent.levelKey}', expected level '${
            this.props.levels[level.depth - 1]!.key
          }'`,
        );
      }
    } else if (level.depth > 0) {
      throw new DefinitionError(
        `member '${input.key}' at level '${levelKey}' requires a parentKey`,
      );
    }

    const member: DimensionMember = {
      key: input.key,
      label: input.label.trim() || input.key,
      levelKey,
      parentKey: input.parentKey,
      attributes: { ...(input.attributes ?? {}) },
    };
    this.props.members.set(member.key, member);
    this.touch();
    return member;
  }

  /**
   * Walks a leaf member up to the requested level. Returns null when the
   * member is unknown or the chain is incomplete; callers surface that as an
   * "(unmapped)" bucket rather than silently dropping the fact.
   */
  rollUp(memberKey: string, targetLevelKey: string): string | null {
    const target = this.level(targetLevelKey);
    if (!target) return null;
    let current = this.props.members.get(memberKey);
    // The chain is at most `levels.length` long; the bound also protects
    // against a corrupted parent cycle in rehydrated data.
    for (let hops = 0; current && hops <= this.props.levels.length; hops += 1) {
      if (current.levelKey === targetLevelKey) return current.key;
      const currentLevel = this.level(current.levelKey);
      if (!currentLevel || currentLevel.depth <= target.depth) return null;
      current = current.parentKey ? this.props.members.get(current.parentKey) : undefined;
    }
    return null;
  }

  /** Display label for a member key, falling back to the key itself. */
  labelFor(memberKey: string): string {
    return this.props.members.get(memberKey)?.label ?? memberKey;
  }

  /** Direct children of a member, ordered by label. */
  childrenOf(memberKey: string): DimensionMember[] {
    return this.members()
      .filter((m) => m.parentKey === memberKey)
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /** The full ancestor chain (nearest parent first). */
  ancestry(memberKey: string): DimensionMember[] {
    const chain: DimensionMember[] = [];
    let current = this.props.members.get(memberKey)?.parentKey;
    while (current && chain.length <= this.props.levels.length) {
      const parent = this.props.members.get(current);
      if (!parent) break;
      chain.push(parent);
      current = parent.parentKey;
    }
    return chain;
  }
}

import {
  envelope,
  newId,
  NotFoundError,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  buildCategoryTree,
  CATEGORY_RISK_TIERS,
  childPath,
  descendantsOf,
  isDescendantOf,
  resolveCategoryPolicy,
  type CategoryPolicy,
  type CategoryRecord,
  type CategoryRiskTier,
  type CategoryTreeNode,
} from "../domain/category.js";
import { isCertificationType, type CertificationType } from "../domain/certification.js";
import { nonEmpty, slug } from "../domain/common.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { SrmEventTypes } from "../domain/events.js";
import type { CategoryRepository, Clock, OutboxPort } from "./ports.js";

export interface CreateCategoryCommand {
  readonly code: string;
  readonly name: string;
  readonly parentId?: Ulid;
  readonly riskTier?: CategoryRiskTier;
  readonly requiresQualification?: boolean;
  readonly requiredCertifications?: readonly string[];
  readonly requalificationMonths?: number;
  readonly managerUserId?: string;
  readonly sortOrder?: number;
}

export interface UpdateCategoryCommand {
  readonly name?: string;
  readonly riskTier?: CategoryRiskTier;
  readonly requiresQualification?: boolean;
  readonly requiredCertifications?: readonly string[];
  readonly requalificationMonths?: number;
  readonly managerUserId?: string | null;
  readonly sortOrder?: number;
  readonly isActive?: boolean;
}

/**
 * Procurement category taxonomy.
 *
 * The tree invariants live here rather than in a record: codes are unique per
 * tenant, a move may not create a cycle, and the materialized `path` of every
 * descendant is rewritten in the same operation so reads never need a
 * recursive query.
 */
export class CategoryService {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, command: CreateCategoryCommand): Promise<CategoryRecord> {
    const code = slug(command.code, "code");
    if (await this.categories.byCode(ctx.tenantId, code)) {
      throw new InvalidStateError(`Category ${code} already exists`);
    }
    const parent = command.parentId ? await this.require(ctx, command.parentId) : undefined;
    const now = this.clock.now();
    const record: CategoryRecord = {
      id: newId("category"),
      tenantId: ctx.tenantId,
      code,
      name: nonEmpty(command.name, "name"),
      parentId: parent?.id,
      path: childPath(parent, code),
      level: parent ? parent.level + 1 : 0,
      riskTier: this.requireTier(command.riskTier ?? "medium"),
      requiresQualification: command.requiresQualification ?? false,
      requiredCertifications: this.parseCertifications(command.requiredCertifications),
      requalificationMonths: this.requireMonths(command.requalificationMonths ?? 24),
      managerUserId: command.managerUserId?.trim() || undefined,
      sortOrder: command.sortOrder ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.categories.save(record);
    await this.publish(ctx, SrmEventTypes.CategoryCreated, record, {
      parentId: record.parentId,
      path: record.path,
      riskTier: record.riskTier,
    });
    return record;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<CategoryRecord> {
    return this.require(ctx, id);
  }

  async getByCode(ctx: TenantContext, code: string): Promise<CategoryRecord> {
    const record = await this.categories.byCode(ctx.tenantId, slug(code, "code"));
    if (!record) throw new NotFoundError("Category", code);
    return record;
  }

  async list(ctx: TenantContext): Promise<readonly CategoryRecord[]> {
    const all = await this.categories.all(ctx.tenantId);
    return [...all].sort((a, b) => a.path.localeCompare(b.path));
  }

  async tree(ctx: TenantContext): Promise<CategoryTreeNode[]> {
    return buildCategoryTree(await this.categories.all(ctx.tenantId));
  }

  async update(ctx: TenantContext, id: Ulid, command: UpdateCategoryCommand): Promise<CategoryRecord> {
    const current = await this.require(ctx, id);
    const updated: CategoryRecord = {
      ...current,
      name: command.name !== undefined ? nonEmpty(command.name, "name") : current.name,
      riskTier: command.riskTier !== undefined ? this.requireTier(command.riskTier) : current.riskTier,
      requiresQualification: command.requiresQualification ?? current.requiresQualification,
      requiredCertifications:
        command.requiredCertifications !== undefined
          ? this.parseCertifications(command.requiredCertifications)
          : current.requiredCertifications,
      requalificationMonths:
        command.requalificationMonths !== undefined
          ? this.requireMonths(command.requalificationMonths)
          : current.requalificationMonths,
      managerUserId:
        command.managerUserId === undefined
          ? current.managerUserId
          : command.managerUserId === null
            ? undefined
            : command.managerUserId.trim(),
      sortOrder: command.sortOrder ?? current.sortOrder,
      isActive: command.isActive ?? current.isActive,
      updatedAt: this.clock.now(),
    };
    await this.categories.save(updated);
    await this.publish(ctx, SrmEventTypes.CategoryUpdated, updated, { path: updated.path });
    return updated;
  }

  /**
   * Re-parents a node. Moving a node under its own descendant would create a
   * cycle and orphan the subtree, so it is rejected; otherwise every
   * descendant's path is rewritten in the same call.
   */
  async move(ctx: TenantContext, id: Ulid, newParentId?: Ulid): Promise<CategoryRecord> {
    const record = await this.require(ctx, id);
    const all = await this.categories.all(ctx.tenantId);
    const byId = new Map(all.map((entry) => [entry.id, entry]));

    let parent: CategoryRecord | undefined;
    if (newParentId) {
      parent = byId.get(newParentId);
      if (!parent) throw new NotFoundError("Category", newParentId);
      if (parent.id === record.id) {
        throw new ValidationError("A category cannot be its own parent");
      }
      if (isDescendantOf(byId, parent, record.id)) {
        throw new InvalidStateError(`Moving ${record.code} under ${parent.code} would create a cycle`);
      }
    }
    if (record.parentId === parent?.id) return record;

    const now = this.clock.now();
    const moved: CategoryRecord = {
      ...record,
      parentId: parent?.id,
      path: childPath(parent, record.code),
      level: parent ? parent.level + 1 : 0,
      updatedAt: now,
    };
    const oldPrefix = `${record.path}/`;
    const rewritten = descendantsOf(all, record.id).map((descendant) => ({
      ...descendant,
      path: `${moved.path}/${descendant.path.slice(oldPrefix.length)}`,
      level: moved.level + (descendant.level - record.level),
      updatedAt: now,
    }));
    await this.categories.saveMany([moved, ...rewritten]);
    await this.publish(ctx, SrmEventTypes.CategoryMoved, moved, {
      from: record.path,
      to: moved.path,
      descendantsRewritten: rewritten.length,
    });
    return moved;
  }

  /** Effective policy after merging the ancestor chain. */
  async policy(ctx: TenantContext, id: Ulid): Promise<CategoryPolicy> {
    const all = await this.categories.all(ctx.tenantId);
    const policy = resolveCategoryPolicy(new Map(all.map((entry) => [entry.id, entry])), id);
    if (!policy) throw new NotFoundError("Category", id);
    return policy;
  }

  private async require(ctx: TenantContext, id: Ulid): Promise<CategoryRecord> {
    const record = await this.categories.byId(ctx.tenantId, id);
    if (!record) throw new NotFoundError("Category", id);
    return record;
  }

  private requireTier(tier: CategoryRiskTier): CategoryRiskTier {
    if (!CATEGORY_RISK_TIERS.includes(tier)) {
      throw ValidationError.single("riskTier", `must be one of [${CATEGORY_RISK_TIERS.join(", ")}]`);
    }
    return tier;
  }

  private requireMonths(months: number): number {
    if (!Number.isInteger(months) || months < 3 || months > 60) {
      throw ValidationError.single("requalificationMonths", "must be an integer between 3 and 60");
    }
    return months;
  }

  private parseCertifications(values?: readonly string[]): readonly CertificationType[] {
    const parsed = (values ?? []).map((value) => {
      const normalized = value.trim().toLowerCase();
      if (!isCertificationType(normalized)) {
        throw ValidationError.single("requiredCertifications", `unknown certification type "${value}"`);
      }
      return normalized;
    });
    return [...new Set(parsed)].sort();
  }

  private async publish(
    ctx: TenantContext,
    eventType: string,
    record: CategoryRecord,
    extra: Record<string, unknown>,
  ): Promise<void> {
    await this.outbox.publish([
      envelope({
        eventType,
        aggregateType: "Category",
        aggregateId: record.id,
        tenantId: ctx.tenantId,
        payload: { categoryId: record.id, code: record.code, name: record.name, ...extra },
      }),
    ]);
  }
}

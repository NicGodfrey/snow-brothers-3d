import {
  ConflictError,
  NotFoundError,
  envelope,
  newId,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  CATEGORY_CODE_PATTERN,
  buildCategoryTree,
  childPath,
  isDescendantOf,
  type CategoryRecord,
  type CategoryTreeNode,
} from "../domain/category.js";
import { ValidationError } from "../domain/errors.js";
import { PlmEventTypes } from "../domain/events.js";
import type { CategoryRepository, Clock, OutboxPort } from "./ports.js";

export interface CreateCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly parentId?: Ulid;
  readonly sortOrder?: number;
}

export class CategoryService {
  constructor(
    private readonly categories: CategoryRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async create(ctx: TenantContext, input: CreateCategoryInput): Promise<CategoryRecord> {
    const code = input.code.trim().toLowerCase();
    if (!CATEGORY_CODE_PATTERN.test(code)) {
      throw ValidationError.single("code", `invalid category code "${input.code}"`);
    }
    if (input.name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    if (await this.categories.byCode(ctx.tenantId, code)) {
      throw new ConflictError(`Category "${code}" already exists`);
    }
    let parent: CategoryRecord | undefined;
    if (input.parentId) {
      parent = await this.categories.byId(ctx.tenantId, input.parentId);
      if (!parent) throw new NotFoundError("Category", input.parentId);
    }
    const now = this.clock.now();
    const record: CategoryRecord = {
      id: newId("category"),
      tenantId: ctx.tenantId,
      code,
      name: input.name.trim(),
      parentId: parent?.id,
      path: childPath(parent, code),
      sortOrder: input.sortOrder ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await this.categories.save(record);
    await this.outbox.publish([
      envelope({
        eventType: PlmEventTypes.CategoryCreated,
        aggregateType: "Category",
        aggregateId: record.id,
        tenantId: ctx.tenantId,
        payload: { categoryId: record.id, code: record.code, path: record.path },
      }),
    ]);
    return record;
  }

  async rename(ctx: TenantContext, id: Ulid, name: string): Promise<CategoryRecord> {
    const record = await this.mustGet(ctx, id);
    if (name.trim().length === 0) {
      throw ValidationError.single("name", "name is required");
    }
    const updated: CategoryRecord = { ...record, name: name.trim(), updatedAt: this.clock.now() };
    await this.categories.save(updated);
    return updated;
  }

  /**
   * Re-parents a category. Rejects moves under the category's own subtree
   * (cycle) and recomputes materialized paths for all descendants.
   */
  async move(ctx: TenantContext, id: Ulid, newParentId: Ulid | undefined): Promise<CategoryRecord> {
    const record = await this.mustGet(ctx, id);
    if (newParentId === id) {
      throw new ConflictError("A category cannot be its own parent");
    }
    let parent: CategoryRecord | undefined;
    if (newParentId) {
      parent = await this.categories.byId(ctx.tenantId, newParentId);
      if (!parent) throw new NotFoundError("Category", newParentId);
      const all = await this.categories.all(ctx.tenantId);
      const byId = new Map(all.map((c) => [c.id, c]));
      if (isDescendantOf(byId, parent, id)) {
        throw new ConflictError(`Cannot move "${record.code}" under its own descendant "${parent.code}"`);
      }
    }
    const now = this.clock.now();
    const moved: CategoryRecord = {
      ...record,
      parentId: parent?.id,
      path: childPath(parent, record.code),
      updatedAt: now,
    };
    await this.categories.save(moved);
    await this.rewriteDescendantPaths(ctx, moved);
    await this.outbox.publish([
      envelope({
        eventType: PlmEventTypes.CategoryMoved,
        aggregateType: "Category",
        aggregateId: moved.id,
        tenantId: ctx.tenantId,
        payload: { categoryId: moved.id, code: moved.code, newParentId: parent?.id, path: moved.path },
      }),
    ]);
    return moved;
  }

  async tree(ctx: TenantContext): Promise<CategoryTreeNode[]> {
    return buildCategoryTree(await this.categories.all(ctx.tenantId));
  }

  async get(ctx: TenantContext, id: Ulid): Promise<CategoryRecord> {
    return this.mustGet(ctx, id);
  }

  private async mustGet(ctx: TenantContext, id: Ulid): Promise<CategoryRecord> {
    const record = await this.categories.byId(ctx.tenantId, id);
    if (!record) throw new NotFoundError("Category", id);
    return record;
  }

  private async rewriteDescendantPaths(ctx: TenantContext, root: CategoryRecord): Promise<void> {
    const all = await this.categories.all(ctx.tenantId);
    const childrenOf = new Map<Ulid, CategoryRecord[]>();
    for (const c of all) {
      if (!c.parentId) continue;
      const list = childrenOf.get(c.parentId) ?? [];
      list.push(c);
      childrenOf.set(c.parentId, list);
    }
    const stack: CategoryRecord[] = [root];
    while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of childrenOf.get(current.id) ?? []) {
        const updated: CategoryRecord = {
          ...child,
          path: `${current.path}/${child.code}`,
          updatedAt: this.clock.now(),
        };
        await this.categories.save(updated);
        stack.push(updated);
      }
    }
  }
}

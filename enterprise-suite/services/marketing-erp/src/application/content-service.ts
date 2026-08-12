import {
  ConflictError,
  DomainError,
  ForbiddenError,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import {
  assertContentKind,
  ContentAsset,
  CONTENT_STATUSES,
  type ContentStatus,
} from "../domain/content-asset.js";
import type { Clock, ContentAssetRepository, OutboxPort } from "./ports.js";

const APPROVER_ROLES = ["admin", "marketing_manager"];

export interface CreateContentInput {
  title: string;
  slug: string;
  kind: string;
  body: string;
  subject?: string;
  locale?: string;
  tags?: string[];
}

export class ContentService {
  constructor(
    private readonly contents: ContentAssetRepository,
    private readonly clock: Clock,
    private readonly outbox: OutboxPort,
  ) {}

  private persist(asset: ContentAsset): ContentAsset {
    this.contents.save(asset);
    this.outbox.publish(asset.pullEvents());
    return asset;
  }

  create(ctx: TenantContext, input: CreateContentInput): ContentAsset {
    if (this.contents.findBySlug(ctx.tenantId, input.slug)) {
      throw new ConflictError(`Content slug already exists: ${input.slug}`);
    }
    const asset = ContentAsset.create({
      tenantId: ctx.tenantId,
      title: input.title,
      slug: input.slug,
      kind: assertContentKind(input.kind),
      body: input.body,
      subject: input.subject,
      locale: input.locale,
      tags: input.tags,
      createdAt: this.clock.nowIso(),
    });
    return this.persist(asset);
  }

  get(ctx: TenantContext, id: string): ContentAsset {
    return this.contents.getOrThrow(ctx.tenantId, id);
  }

  getBySlug(ctx: TenantContext, slug: string): ContentAsset | undefined {
    return this.contents.findBySlug(ctx.tenantId, slug);
  }

  list(
    ctx: TenantContext,
    filter?: { kind?: string; status?: string },
    page?: Partial<PageRequest>,
  ): Page<ContentAsset> {
    let items = this.contents.list(ctx.tenantId);
    if (filter?.kind !== undefined) {
      const kind = assertContentKind(filter.kind);
      items = items.filter((a) => a.kind === kind);
    }
    if (filter?.status !== undefined) {
      if (!(CONTENT_STATUSES as readonly string[]).includes(filter.status)) {
        throw new DomainError(`Unknown content status: ${filter.status}`, "CONTENT_INVALID_STATUS");
      }
      items = items.filter((a) => a.status === (filter.status as ContentStatus));
    }
    items.sort((a, b) => a.slug.localeCompare(b.slug));
    return paginate(items, normalizePage(page));
  }

  submitForReview(ctx: TenantContext, id: string): ContentAsset {
    const asset = this.contents.getOrThrow(ctx.tenantId, id);
    asset.submitForReview();
    return this.persist(asset);
  }

  approve(ctx: TenantContext, id: string): ContentAsset {
    if (!ctx.roles.some((role) => APPROVER_ROLES.includes(role))) {
      throw new ForbiddenError(
        `Approving content requires one of roles: ${APPROVER_ROLES.join(", ")}`,
      );
    }
    const asset = this.contents.getOrThrow(ctx.tenantId, id);
    asset.approve(ctx.userId, this.clock.nowIso());
    return this.persist(asset);
  }

  reject(ctx: TenantContext, id: string, reason: string): ContentAsset {
    if (!ctx.roles.some((role) => APPROVER_ROLES.includes(role))) {
      throw new ForbiddenError(
        `Rejecting content requires one of roles: ${APPROVER_ROLES.join(", ")}`,
      );
    }
    const asset = this.contents.getOrThrow(ctx.tenantId, id);
    asset.reject(reason);
    return this.persist(asset);
  }

  retire(ctx: TenantContext, id: string): ContentAsset {
    const asset = this.contents.getOrThrow(ctx.tenantId, id);
    asset.retire();
    return this.persist(asset);
  }

  revise(
    ctx: TenantContext,
    id: string,
    input: { body: string; subject?: string; changeNote?: string },
  ): ContentAsset {
    const asset = this.contents.getOrThrow(ctx.tenantId, id);
    asset.revise({ ...input, at: this.clock.nowIso() });
    return this.persist(asset);
  }

  /** Renders the template with sample variables, reporting unresolved placeholders. */
  preview(
    ctx: TenantContext,
    id: string,
    vars: Record<string, string>,
  ): { subject?: string; body: string; missingVariables: string[]; variables: string[] } {
    const asset = this.contents.getOrThrow(ctx.tenantId, id);
    const rendered = asset.render(vars);
    return { ...rendered, variables: asset.variables };
  }
}

import { NotFoundError, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type {
  AudienceRepository,
  BudgetRepository,
  CampaignRepository,
  ChannelRepository,
  ContentAssetRepository,
  LeadRepository,
  RepositoryPort,
  ScoringModelRepository,
  SegmentRepository,
  SendJobRepository,
  TouchpointRepository,
  TrackedLinkRepository,
} from "../application/ports.js";
import type { Audience } from "../domain/audience.js";
import type { CampaignBudget } from "../domain/budget.js";
import type { Campaign } from "../domain/campaign.js";
import type { Channel } from "../domain/channel.js";
import type { ContentAsset } from "../domain/content-asset.js";
import type { Lead, LeadStage } from "../domain/lead.js";
import type { ScoringModel } from "../domain/lead-scoring.js";
import type { Segment } from "../domain/segment.js";
import type { SendJob } from "../domain/send-job.js";
import type { Touchpoint } from "../domain/touchpoint.js";
import type { TrackedLink } from "../domain/utm.js";

interface TenantScoped {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

/**
 * Map-backed repository. Aggregates are stored by reference — callers get
 * the live object, mirroring an identity-map ORM session. The interfaces
 * stay persistence-agnostic so a Postgres adapter can replace this 1:1.
 */
class InMemoryRepository<T extends TenantScoped> implements RepositoryPort<T> {
  protected readonly items = new Map<string, T>();

  constructor(private readonly resourceName: string) {}

  save(entity: T): T {
    this.items.set(entity.id, entity);
    return entity;
  }

  findById(tenantId: TenantId, id: string): T | undefined {
    const entity = this.items.get(id);
    return entity && entity.tenantId === tenantId ? entity : undefined;
  }

  getOrThrow(tenantId: TenantId, id: string): T {
    const entity = this.findById(tenantId, id);
    if (!entity) throw new NotFoundError(this.resourceName, id);
    return entity;
  }

  list(tenantId: TenantId): T[] {
    return [...this.items.values()].filter((e) => e.tenantId === tenantId);
  }

  clear(): void {
    this.items.clear();
  }
}

export class InMemoryChannelRepository
  extends InMemoryRepository<Channel>
  implements ChannelRepository
{
  constructor() {
    super("Channel");
  }

  findByCode(tenantId: TenantId, code: string): Channel | undefined {
    return this.list(tenantId).find((c) => c.code === code);
  }
}

export class InMemoryCampaignRepository
  extends InMemoryRepository<Campaign>
  implements CampaignRepository
{
  constructor() {
    super("Campaign");
  }

  findByCode(tenantId: TenantId, code: string): Campaign | undefined {
    return this.list(tenantId).find((c) => c.code === code);
  }
}

export class InMemorySegmentRepository
  extends InMemoryRepository<Segment>
  implements SegmentRepository
{
  constructor() {
    super("Segment");
  }
}

export class InMemoryAudienceRepository
  extends InMemoryRepository<Audience>
  implements AudienceRepository
{
  constructor() {
    super("Audience");
  }
}

export class InMemoryLeadRepository extends InMemoryRepository<Lead> implements LeadRepository {
  constructor() {
    super("Lead");
  }

  findByEmail(tenantId: TenantId, email: string): Lead | undefined {
    return this.list(tenantId).find((l) => l.email === email);
  }

  listByStage(tenantId: TenantId, stage: LeadStage): Lead[] {
    return this.list(tenantId).filter((l) => l.stage === stage);
  }
}

export class InMemoryScoringModelRepository
  extends InMemoryRepository<ScoringModel>
  implements ScoringModelRepository
{
  constructor() {
    super("ScoringModel");
  }

  findDefault(tenantId: TenantId): ScoringModel | undefined {
    return this.list(tenantId).find((m) => m.isDefault);
  }
}

export class InMemoryContentAssetRepository
  extends InMemoryRepository<ContentAsset>
  implements ContentAssetRepository
{
  constructor() {
    super("ContentAsset");
  }

  findBySlug(tenantId: TenantId, slug: string): ContentAsset | undefined {
    return this.list(tenantId).find((a) => a.slug === slug);
  }
}

export class InMemorySendJobRepository
  extends InMemoryRepository<SendJob>
  implements SendJobRepository
{
  constructor() {
    super("SendJob");
  }

  listByCampaign(tenantId: TenantId, campaignId: Ulid): SendJob[] {
    return this.list(tenantId).filter((j) => j.campaignId === campaignId);
  }
}

export class InMemoryTouchpointRepository implements TouchpointRepository {
  private readonly items: Touchpoint[] = [];

  append(touchpoint: Touchpoint): Touchpoint {
    this.items.push(touchpoint);
    return touchpoint;
  }

  listByLead(tenantId: TenantId, leadId: Ulid): Touchpoint[] {
    return this.items.filter((t) => t.tenantId === tenantId && t.leadId === leadId);
  }

  listByCampaign(tenantId: TenantId, campaignId: Ulid): Touchpoint[] {
    return this.items.filter((t) => t.tenantId === tenantId && t.campaignId === campaignId);
  }

  listAll(tenantId: TenantId): Touchpoint[] {
    return this.items.filter((t) => t.tenantId === tenantId);
  }

  clear(): void {
    this.items.length = 0;
  }
}

export class InMemoryTrackedLinkRepository
  extends InMemoryRepository<TrackedLink>
  implements TrackedLinkRepository
{
  constructor() {
    super("TrackedLink");
  }

  findByCode(tenantId: TenantId, shortCode: string): TrackedLink | undefined {
    return this.list(tenantId).find((l) => l.shortCode === shortCode);
  }
}

export class InMemoryBudgetRepository
  extends InMemoryRepository<CampaignBudget>
  implements BudgetRepository
{
  constructor() {
    super("CampaignBudget");
  }

  findByCampaign(tenantId: TenantId, campaignId: Ulid): CampaignBudget | undefined {
    return this.list(tenantId).find((b) => b.campaignId === campaignId);
  }
}

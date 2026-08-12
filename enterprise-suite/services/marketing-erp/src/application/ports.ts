import type {
  EventEnvelope,
  IsoDateTime,
  TenantId,
  Ulid,
} from "@enterprise-suite/shared-kernel";
import type { Audience } from "../domain/audience.js";
import type { CampaignBudget } from "../domain/budget.js";
import type { Campaign } from "../domain/campaign.js";
import type { Channel } from "../domain/channel.js";
import type { ContentAsset } from "../domain/content-asset.js";
import type { Lead, LeadStage } from "../domain/lead.js";
import type { ScoringModel } from "../domain/lead-scoring.js";
import type { Segment } from "../domain/segment.js";
import type { DeliveryOutcome, SendChannelKind, SendJob } from "../domain/send-job.js";
import type { Touchpoint } from "../domain/touchpoint.js";
import type { TrackedLink } from "../domain/utm.js";

/** Time source; injectable so tests and replays control decay and windows. */
export interface Clock {
  now(): Date;
  nowIso(): IsoDateTime;
}

/**
 * Transactional outbox: services push events raised by aggregates here in
 * the same logical transaction as the state change. A dispatcher relays
 * them to the event bus.
 */
export interface OutboxPort {
  publish(events: readonly EventEnvelope[]): void;
}

interface TenantScoped {
  readonly id: Ulid;
  readonly tenantId: TenantId;
}

export interface RepositoryPort<T extends TenantScoped> {
  save(entity: T): T;
  findById(tenantId: TenantId, id: string): T | undefined;
  /** Throws NotFoundError when absent. */
  getOrThrow(tenantId: TenantId, id: string): T;
  list(tenantId: TenantId): T[];
}

export interface ChannelRepository extends RepositoryPort<Channel> {
  findByCode(tenantId: TenantId, code: string): Channel | undefined;
}

export interface CampaignRepository extends RepositoryPort<Campaign> {
  findByCode(tenantId: TenantId, code: string): Campaign | undefined;
}

export type SegmentRepository = RepositoryPort<Segment>;

export type AudienceRepository = RepositoryPort<Audience>;

export interface LeadRepository extends RepositoryPort<Lead> {
  findByEmail(tenantId: TenantId, email: string): Lead | undefined;
  listByStage(tenantId: TenantId, stage: LeadStage): Lead[];
}

export interface ScoringModelRepository extends RepositoryPort<ScoringModel> {
  findDefault(tenantId: TenantId): ScoringModel | undefined;
}

export interface ContentAssetRepository extends RepositoryPort<ContentAsset> {
  findBySlug(tenantId: TenantId, slug: string): ContentAsset | undefined;
}

export interface SendJobRepository extends RepositoryPort<SendJob> {
  listByCampaign(tenantId: TenantId, campaignId: Ulid): SendJob[];
}

/** Touchpoints are append-only facts; there is no update or delete. */
export interface TouchpointRepository {
  append(touchpoint: Touchpoint): Touchpoint;
  listByLead(tenantId: TenantId, leadId: Ulid): Touchpoint[];
  listByCampaign(tenantId: TenantId, campaignId: Ulid): Touchpoint[];
  listAll(tenantId: TenantId): Touchpoint[];
}

export interface TrackedLinkRepository extends RepositoryPort<TrackedLink> {
  findByCode(tenantId: TenantId, shortCode: string): TrackedLink | undefined;
}

export interface BudgetRepository extends RepositoryPort<CampaignBudget> {
  findByCampaign(tenantId: TenantId, campaignId: Ulid): CampaignBudget | undefined;
}

export interface OutboundMessage {
  readonly jobId: Ulid;
  readonly channel: SendChannelKind;
  readonly to: string;
  readonly subject?: string;
  readonly body: string;
}

/**
 * Delivery gateway. The bundled implementation simulates providers with a
 * deterministic seeded model; a real ESP/SMS adapter implements the same port.
 */
export interface MessageSenderPort {
  send(message: OutboundMessage): DeliveryOutcome;
}

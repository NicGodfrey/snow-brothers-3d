import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi } from "./module-api.js";
import type { ApiPage, ListQuery } from "./types.js";

/** Typed stub for `marketing-erp`: campaigns, leads, segments, attribution. */

export type CampaignStatus = "draft" | "scheduled" | "running" | "paused" | "completed";
export type CampaignChannel = "email" | "paid-search" | "social" | "events" | "partner";
export type LeadStatus = "new" | "working" | "qualified" | "routed" | "disqualified";

export interface CampaignDto {
  readonly id: string;
  readonly name: string;
  readonly channel: CampaignChannel;
  readonly status: CampaignStatus;
  readonly budget: Money;
  readonly spend: Money;
  readonly startsOn: string;
  readonly endsOn?: string;
  readonly leadsGenerated: number;
  readonly influencedPipeline: Money;
}

export interface LeadDto {
  readonly id: string;
  readonly fullName: string;
  readonly company: string;
  readonly email: string;
  readonly score: number;
  readonly status: LeadStatus;
  readonly campaignId?: string;
  readonly assignedTo?: string;
  readonly createdAt: string;
}

export interface SegmentDto {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  readonly memberCount: number;
  readonly refreshCadence: "hourly" | "daily" | "weekly";
  readonly lastRefreshedAt: string;
}

export interface AttributionRowDto {
  readonly id: string;
  readonly channel: CampaignChannel;
  readonly model: "first-touch" | "last-touch" | "linear";
  readonly influencedPipeline: Money;
  readonly closedWon: Money;
  readonly touchCount: number;
}

export interface CreateCampaignInput {
  readonly name: string;
  readonly channel: CampaignChannel;
  readonly budgetMinor: number;
  readonly currency: string;
  readonly startsOn: string;
  readonly endsOn?: string;
  readonly segmentIds?: readonly string[];
}

export interface RouteLeadsInput {
  readonly leadIds: readonly string[];
  readonly ownerId: string;
  readonly reason?: string;
}

export class MarketingApi extends BaseModuleApi {
  readonly module: ModuleKey = "marketing";

  constructor(http: ApiClient) {
    super(http);
  }

  listCampaigns(
    query: ListQuery & { status?: CampaignStatus; channel?: CampaignChannel } = {},
  ): Promise<ApiPage<CampaignDto>> {
    return this.http.get<ApiPage<CampaignDto>>("/campaigns", { query: { ...query } });
  }

  getCampaign(campaignId: string): Promise<CampaignDto> {
    return this.http.get<CampaignDto>(`/campaigns/${encodeURIComponent(campaignId)}`);
  }

  createCampaign(input: CreateCampaignInput, idempotencyKey?: string): Promise<CampaignDto> {
    return this.http.post<CampaignDto>("/campaigns", { body: input, idempotencyKey });
  }

  launchCampaign(campaignId: string): Promise<CampaignDto> {
    return this.http.post<CampaignDto>(`/campaigns/${encodeURIComponent(campaignId)}/launch`, {
      body: {},
    });
  }

  pauseCampaign(campaignId: string, reason: string): Promise<CampaignDto> {
    return this.http.post<CampaignDto>(`/campaigns/${encodeURIComponent(campaignId)}/pause`, {
      body: { reason },
    });
  }

  listLeads(
    query: ListQuery & { status?: LeadStatus; minScore?: number } = {},
  ): Promise<ApiPage<LeadDto>> {
    return this.http.get<ApiPage<LeadDto>>("/leads", { query: { ...query } });
  }

  routeLeads(input: RouteLeadsInput): Promise<{ readonly routed: number }> {
    return this.http.post<{ readonly routed: number }>("/leads/route", { body: input });
  }

  listSegments(query: ListQuery = {}): Promise<ApiPage<SegmentDto>> {
    return this.http.get<ApiPage<SegmentDto>>("/segments", { query: { ...query } });
  }

  refreshSegment(segmentId: string): Promise<SegmentDto> {
    return this.http.post<SegmentDto>(`/segments/${encodeURIComponent(segmentId)}/refresh`, {
      body: {},
    });
  }

  listAttribution(
    query: ListQuery & { model?: AttributionRowDto["model"] } = {},
  ): Promise<ApiPage<AttributionRowDto>> {
    return this.http.get<ApiPage<AttributionRowDto>>("/attribution", { query: { ...query } });
  }
}

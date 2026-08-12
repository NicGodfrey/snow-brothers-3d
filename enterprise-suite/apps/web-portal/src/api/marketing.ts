import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import {
  BaseModuleApi,
  asPage,
  composeHits,
  count,
  emptyPage,
  hitSource,
  moneyValue,
  percent,
  statusOf,
  sumMoney,
  type ModuleSummaryDto,
  type SearchHit,
} from "./module-api.js";
import type { ApiPage, ListQuery, RequestOptions, RowLike } from "./types.js";

/**
 * Typed client for `marketing-erp` behind the gateway's `/api/marketing`
 * prefix. Campaigns and leads are live routes; summary/search are composed
 * from them client-side. Segments and attribution have no gateway route yet.
 */

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

  override async summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    const [campaigns, leads] = await Promise.all([
      this.listCampaigns({ pageSize: 100 }, options),
      this.listLeads({ pageSize: 100 }, options).catch(() => emptyPage<LeadDto>()),
    ]);

    const active = campaigns.items.filter((c) => statusOf(c) === "running").length;
    const spendToDate = sumMoney(campaigns.items.map((c) => c.spend));
    const unrouted = leads.items.filter((l) => statusOf(l) === "new").length;
    const progressed = leads.items.filter((l) => ["qualified", "routed"].includes(statusOf(l))).length;

    return {
      module: "marketing",
      asOf: new Date().toISOString(),
      metrics: {
        activeCampaigns: count(active),
        ...(spendToDate ? { spendToDate: moneyValue(spendToDate) } : {}),
        unroutedLeads: count(unrouted),
        leadToQuoteRate: percent(leads.items.length > 0 ? progressed / leads.items.length : 0),
      },
    };
  }

  override async list(
    resource: string,
    query?: ListQuery,
    options?: RequestOptions,
  ): Promise<ApiPage<RowLike>> {
    switch (resource) {
      case "campaigns":
        return (await this.listCampaigns(query, options)) as unknown as ApiPage<RowLike>;
      case "leads":
        return (await this.listLeads(query, options)) as unknown as ApiPage<RowLike>;
      case "segments":
        return (await this.listSegments(query, options)) as unknown as ApiPage<RowLike>;
      case "attribution":
        return (await this.listAttribution(query, options)) as unknown as ApiPage<RowLike>;
      default:
        return super.list(resource, query, options);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    if (!term.trim()) return [];
    const [campaigns, leads] = await Promise.all([
      this.listCampaigns({ pageSize: 50 }, options),
      this.listLeads({ pageSize: 50 }, options).catch(() => emptyPage<LeadDto>()),
    ]);
    return composeHits("marketing", term, limit, [
      hitSource({
        slug: "campaigns",
        rows: campaigns.items,
        fields: ["name", "channel", "status"],
        title: (row) => row.name,
        subtitle: (row) => `Campaign · ${row.channel} · ${row.status}`,
      }),
      hitSource({
        slug: "leads",
        rows: leads.items,
        fields: ["fullName", "company", "email", "status"],
        title: (row) => `${row.fullName} · ${row.company}`,
        subtitle: (row) => `Lead · score ${row.score}`,
      }),
    ]);
  }

  listCampaigns(
    query: ListQuery & { status?: CampaignStatus; channel?: CampaignChannel } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<CampaignDto>> {
    return this.http
      .get<unknown>("/campaigns", { ...options, query: { ...query } })
      .then(asPage<CampaignDto>);
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
    options?: RequestOptions,
  ): Promise<ApiPage<LeadDto>> {
    return this.http
      .get<unknown>("/leads", { ...options, query: { ...query } })
      .then(asPage<LeadDto>);
  }

  routeLeads(input: RouteLeadsInput): Promise<{ readonly routed: number }> {
    return this.http.post<{ readonly routed: number }>("/leads/route", { body: input });
  }

  listSegments(query: ListQuery = {}, options?: RequestOptions): Promise<ApiPage<SegmentDto>> {
    return this.http
      .get<unknown>("/segments", { ...options, query: { ...query } })
      .then(asPage<SegmentDto>);
  }

  refreshSegment(segmentId: string): Promise<SegmentDto> {
    return this.http.post<SegmentDto>(`/segments/${encodeURIComponent(segmentId)}/refresh`, {
      body: {},
    });
  }

  listAttribution(
    query: ListQuery & { model?: AttributionRowDto["model"] } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<AttributionRowDto>> {
    return this.http
      .get<unknown>("/attribution", { ...options, query: { ...query } })
      .then(asPage<AttributionRowDto>);
  }
}

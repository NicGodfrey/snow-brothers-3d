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
 * PRM portal client.
 *
 * Partners and MDF live on `/api/prm` (prm-core, MDF at `mdf/requests`);
 * deal registrations live on `/api/channel` (channel-prm). Shell-facing
 * summary/search are composed locally so backends need no synthetic
 * `/summary` routes. Enablement has no gateway route yet.
 */

export type PartnerTier = "registered" | "silver" | "gold" | "platinum" | string;
export type PartnerStatus = "onboarding" | "active" | "suspended" | "terminated" | string;
export type DealStatus = "submitted" | "approved" | "rejected" | "expired" | "won" | string;
export type MdfStatus = "requested" | "approved" | "claimed" | "rejected" | string;

export interface PartnerDto {
  readonly id: string;
  readonly name: string;
  readonly tier: PartnerTier;
  readonly status: PartnerStatus;
  readonly region?: string;
  readonly managerId?: string;
  readonly registeredPipeline?: Money;
  readonly certifiedEngineers?: number;
}

export interface DealRegistrationDto {
  readonly id: string;
  readonly reference?: string;
  readonly partnerId: string;
  readonly partnerName?: string;
  readonly customerName?: string;
  readonly status: DealStatus;
  readonly estimatedValue?: Money;
  readonly submittedAt?: string;
  readonly expiresAt?: string;
  readonly conflictsWithOrderId?: string;
}

export interface MdfRequestDto {
  readonly id: string;
  readonly reference?: string;
  readonly partnerId: string;
  readonly partnerName?: string;
  readonly activity?: string;
  readonly status: MdfStatus;
  readonly requested?: Money;
  readonly approved?: Money;
  readonly claimedAt?: string;
}

export interface EnablementRowDto {
  readonly id: string;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly track: string;
  readonly requiredCertifications: number;
  readonly achievedCertifications: number;
  readonly compliant: boolean;
}

export interface ApproveDealInput {
  readonly validForDays: number;
  readonly comment?: string;
}

export interface ApproveMdfInput {
  readonly approvedMinor: number;
  readonly currency: string;
  readonly comment?: string;
}

export class PrmApi extends BaseModuleApi {
  readonly module: ModuleKey = "prm";
  private readonly channel: ApiClient;

  constructor(prmHttp: ApiClient, channelHttp: ApiClient) {
    super(prmHttp);
    this.channel = channelHttp;
  }

  override async summary(options?: RequestOptions): Promise<ModuleSummaryDto> {
    const [partners, deals, mdf] = await Promise.all([
      this.listPartners({ pageSize: 100 }, options),
      this.listDeals({ pageSize: 100 }, options).catch(() => emptyPage<DealRegistrationDto>()),
      this.listMdfRequests({ pageSize: 100 }, options).catch(() => undefined),
    ]);

    const active = partners.items.filter((p) => statusOf(p) === "active").length;
    const registeredPipeline = sumMoney(partners.items.map((p) => p.registeredPipeline));
    const pendingDeals = deals.items.filter((d) => statusOf(d) === "submitted").length;
    const requestedMinor = sumMoney(mdf?.items.map((m) => m.requested) ?? []);
    const approvedMinor = sumMoney(mdf?.items.map((m) => m.approved) ?? []);

    return {
      module: "prm",
      asOf: new Date().toISOString(),
      metrics: {
        activePartners: count(active),
        ...(registeredPipeline ? { registeredPipeline: moneyValue(registeredPipeline) } : {}),
        pendingDeals: count(pendingDeals),
        ...(mdf
          ? {
              openMdf: count(mdf.items.filter((m) => statusOf(m) === "requested").length),
              mdfUtilisation: percent(
                requestedMinor && requestedMinor.amountMinor > 0
                  ? (approvedMinor?.amountMinor ?? 0) / requestedMinor.amountMinor
                  : 0,
              ),
            }
          : {}),
      },
    };
  }

  override async list(
    resource: string,
    query?: ListQuery,
    options?: RequestOptions,
  ): Promise<ApiPage<RowLike>> {
    switch (resource) {
      case "partners":
        return (await this.listPartners(query, options)) as unknown as ApiPage<RowLike>;
      case "deals":
      case "deal-registrations":
        return (await this.listDeals(query, options)) as unknown as ApiPage<RowLike>;
      case "mdf-requests":
        return (await this.listMdfRequests(query, options)) as unknown as ApiPage<RowLike>;
      case "enablement":
        return (await this.listEnablement(query, options)) as unknown as ApiPage<RowLike>;
      default:
        return super.list(resource, query, options);
    }
  }

  override async search(term: string, limit = 5, options?: RequestOptions): Promise<readonly SearchHit[]> {
    if (!term.trim()) return [];
    const [partners, deals] = await Promise.all([
      this.listPartners({ pageSize: 50 }, options),
      this.listDeals({ pageSize: 50 }, options).catch(() => emptyPage<DealRegistrationDto>()),
    ]);
    return composeHits("prm", term, limit, [
      hitSource({
        slug: "partners",
        rows: partners.items,
        fields: ["name", "tier", "region", "status"],
        title: (row) => row.name,
        subtitle: (row) => `Partner · ${row.tier}`,
      }),
      hitSource({
        slug: "deals",
        rows: deals.items,
        fields: ["reference", "partnerName", "customerName", "status"],
        title: (row) => `${row.reference ?? row.id} · ${row.customerName ?? ""}`,
        subtitle: (row) => `Deal registration · ${row.partnerName ?? row.partnerId}`,
      }),
    ]);
  }

  /** Declared module actions post to the owning service's real routes. */
  override command(slug: string, body: unknown, idempotencyKey?: string): Promise<unknown> {
    switch (slug) {
      case "deals":
        return this.channel.post<unknown>("/deal-registrations", { body, idempotencyKey });
      case "mdf":
        return this.http.post<unknown>("/mdf/requests", { body, idempotencyKey });
      default:
        return super.command(slug, body, idempotencyKey);
    }
  }

  listPartners(
    query: ListQuery & { tier?: PartnerTier; status?: PartnerStatus; region?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<PartnerDto>> {
    return this.http
      .get<unknown>("/partners", { ...options, query: { ...query } })
      .then(asPage<PartnerDto>);
  }

  getPartner(partnerId: string): Promise<PartnerDto> {
    return this.http.get<PartnerDto>(`/partners/${encodeURIComponent(partnerId)}`);
  }

  setPartnerTier(partnerId: string, tier: PartnerTier, effectiveFrom: string): Promise<PartnerDto> {
    return this.http.post<PartnerDto>(`/partners/${encodeURIComponent(partnerId)}/tier`, {
      body: { tier, effectiveFrom },
    });
  }

  listDeals(
    query: ListQuery & { status?: DealStatus; partnerId?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<DealRegistrationDto>> {
    return this.channel
      .get<unknown>("/deal-registrations", { ...options, query: { ...query } })
      .then(asPage<DealRegistrationDto>);
  }

  approveDeal(dealId: string, input: ApproveDealInput): Promise<DealRegistrationDto> {
    return this.channel.post<DealRegistrationDto>(
      `/deal-registrations/${encodeURIComponent(dealId)}/approve`,
      { body: input },
    );
  }

  rejectDeal(dealId: string, reason: string): Promise<DealRegistrationDto> {
    return this.channel.post<DealRegistrationDto>(
      `/deal-registrations/${encodeURIComponent(dealId)}/reject`,
      { body: { reason } },
    );
  }

  listMdfRequests(
    query: ListQuery & { status?: MdfStatus; partnerId?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<MdfRequestDto>> {
    return this.http
      .get<unknown>("/mdf/requests", { ...options, query: { ...query } })
      .then(asPage<MdfRequestDto>);
  }

  approveMdf(requestId: string, input: ApproveMdfInput): Promise<MdfRequestDto> {
    return this.http.post<MdfRequestDto>(
      `/mdf/requests/${encodeURIComponent(requestId)}/approve`,
      { body: input },
    );
  }

  listEnablement(
    query: ListQuery & { partnerId?: string } = {},
    options?: RequestOptions,
  ): Promise<ApiPage<EnablementRowDto>> {
    return this.http
      .get<unknown>("/enablement", { ...options, query: { ...query } })
      .then(asPage<EnablementRowDto>);
  }
}

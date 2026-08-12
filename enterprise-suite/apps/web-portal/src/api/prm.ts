import type { Money } from "@enterprise-suite/shared-kernel";
import type { ModuleKey } from "../domain/module.js";
import type { ApiClient } from "./client.js";
import { BaseModuleApi } from "./module-api.js";
import type { ApiPage, ListQuery } from "./types.js";

/** Typed stub for `prm-core` / `channel-prm`: partners, deals, MDF, enablement. */

export type PartnerTier = "registered" | "silver" | "gold" | "platinum";
export type PartnerStatus = "onboarding" | "active" | "suspended" | "terminated";
export type DealStatus = "submitted" | "approved" | "rejected" | "expired" | "won";
export type MdfStatus = "requested" | "approved" | "claimed" | "rejected";

export interface PartnerDto {
  readonly id: string;
  readonly name: string;
  readonly tier: PartnerTier;
  readonly status: PartnerStatus;
  readonly region: string;
  readonly managerId: string;
  readonly registeredPipeline: Money;
  readonly certifiedEngineers: number;
}

export interface DealRegistrationDto {
  readonly id: string;
  readonly reference: string;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly customerName: string;
  readonly status: DealStatus;
  readonly estimatedValue: Money;
  readonly submittedAt: string;
  readonly expiresAt: string;
  readonly conflictsWithOrderId?: string;
}

export interface MdfRequestDto {
  readonly id: string;
  readonly reference: string;
  readonly partnerId: string;
  readonly partnerName: string;
  readonly activity: string;
  readonly status: MdfStatus;
  readonly requested: Money;
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

  constructor(http: ApiClient) {
    super(http);
  }

  listPartners(
    query: ListQuery & { tier?: PartnerTier; status?: PartnerStatus; region?: string } = {},
  ): Promise<ApiPage<PartnerDto>> {
    return this.http.get<ApiPage<PartnerDto>>("/partners", { query: { ...query } });
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
  ): Promise<ApiPage<DealRegistrationDto>> {
    return this.http.get<ApiPage<DealRegistrationDto>>("/deals", { query: { ...query } });
  }

  approveDeal(dealId: string, input: ApproveDealInput): Promise<DealRegistrationDto> {
    return this.http.post<DealRegistrationDto>(`/deals/${encodeURIComponent(dealId)}/approve`, {
      body: input,
    });
  }

  rejectDeal(dealId: string, reason: string): Promise<DealRegistrationDto> {
    return this.http.post<DealRegistrationDto>(`/deals/${encodeURIComponent(dealId)}/reject`, {
      body: { reason },
    });
  }

  listMdfRequests(
    query: ListQuery & { status?: MdfStatus; partnerId?: string } = {},
  ): Promise<ApiPage<MdfRequestDto>> {
    return this.http.get<ApiPage<MdfRequestDto>>("/mdf-requests", { query: { ...query } });
  }

  approveMdf(requestId: string, input: ApproveMdfInput): Promise<MdfRequestDto> {
    return this.http.post<MdfRequestDto>(`/mdf-requests/${encodeURIComponent(requestId)}/approve`, {
      body: input,
    });
  }

  listEnablement(query: ListQuery & { partnerId?: string } = {}): Promise<ApiPage<EnablementRowDto>> {
    return this.http.get<ApiPage<EnablementRowDto>>("/enablement", { query: { ...query } });
  }
}

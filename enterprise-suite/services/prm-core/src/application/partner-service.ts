import {
  ConflictError,
  NotFoundError,
  envelope,
  normalizePage,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { monthsBetween } from "../domain/dates.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { PrmEventTypes } from "../domain/events.js";
import {
  Partner,
  type AddAddressInput,
  type AddContactInput,
  type CreatePartnerInput,
  type PartnerAddress,
  type PartnerContact,
  type UpdatePartnerProfileInput,
} from "../domain/partner.js";
import {
  recordPerformanceSnapshot,
  trailingPerformance,
  type PerformanceSnapshot,
  type PerformanceSource,
  type TrailingPerformance,
} from "../domain/performance.js";
import type {
  ContractRepository,
  Clock,
  OutboxPort,
  PartnerFilter,
  PartnerRepository,
  PerformanceRepository,
  SequenceRepository,
} from "./ports.js";
import { TRADING_CONTRACT_TYPES } from "../domain/contract.js";

export interface RegisterPartnerCommand extends Omit<CreatePartnerInput, "number"> {}

export interface RecordPerformanceCommand {
  readonly period: string;
  readonly bookedRevenue: Money;
  readonly dealsRegistered?: number;
  readonly dealsWon?: number;
  readonly newLogos?: number;
  readonly source?: PerformanceSource;
}

export interface PartnerHierarchy {
  readonly partner: Partner;
  readonly parent?: Partner;
  readonly children: readonly Partner[];
}

/**
 * Partner lifecycle use cases.
 *
 * The aggregate owns the state machine; this service owns the rules that span
 * aggregates — unique legal names, a distributor parent that really is a
 * distributor, "no activation without a signed trading contract", and
 * "no termination while contracts are live".
 */
export class PartnerService {
  constructor(
    private readonly partners: PartnerRepository,
    private readonly contracts: ContractRepository,
    private readonly performance: PerformanceRepository,
    private readonly sequences: SequenceRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async register(ctx: TenantContext, command: RegisterPartnerCommand): Promise<Partner> {
    const duplicate = await this.partners.byLegalName(ctx.tenantId, command.legalName);
    if (duplicate) {
      throw new ConflictError(`Partner "${command.legalName}" already exists as ${duplicate.number}`);
    }
    if (command.parentPartnerId) {
      const parent = await this.partners.byId(ctx.tenantId, command.parentPartnerId);
      if (!parent) throw new NotFoundError("Partner", command.parentPartnerId);
      if (parent.type !== "distributor") {
        throw new InvalidStateError(
          `${parent.number} is a ${parent.type}; only distributors can have tier-2 partners`,
        );
      }
      if (parent.status === "terminated") {
        throw new InvalidStateError(`${parent.number} is terminated and cannot take on new partners`);
      }
    }
    const sequence = await this.sequences.next(ctx.tenantId, "partner");
    const partner = Partner.create(ctx.tenantId, {
      ...command,
      number: `PRT-${String(sequence).padStart(5, "0")}`,
    });
    await this.commit(partner);
    return partner;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Partner> {
    const partner = await this.partners.byId(ctx.tenantId, id);
    if (!partner) throw new NotFoundError("Partner", id);
    return partner;
  }

  async byNumber(ctx: TenantContext, number: string): Promise<Partner> {
    const partner = await this.partners.byNumber(ctx.tenantId, number);
    if (!partner) throw new NotFoundError("Partner", number);
    return partner;
  }

  async list(ctx: TenantContext, filter: PartnerFilter, page?: Partial<PageRequest>): Promise<Page<Partner>> {
    return this.partners.list(ctx.tenantId, filter, normalizePage(page));
  }

  async hierarchy(ctx: TenantContext, id: Ulid): Promise<PartnerHierarchy> {
    const partner = await this.get(ctx, id);
    const parent = partner.parentPartnerId
      ? await this.partners.byId(ctx.tenantId, partner.parentPartnerId)
      : undefined;
    const children = await this.partners.children(ctx.tenantId, partner.id);
    return { partner, parent, children };
  }

  // --- profile ---------------------------------------------------------------

  async updateProfile(ctx: TenantContext, id: Ulid, input: UpdatePartnerProfileInput): Promise<Partner> {
    const partner = await this.get(ctx, id);
    if (input.legalName !== undefined && input.legalName.trim() !== partner.legalName) {
      const duplicate = await this.partners.byLegalName(ctx.tenantId, input.legalName);
      if (duplicate && duplicate.id !== partner.id) {
        throw new ConflictError(`Partner "${input.legalName}" already exists as ${duplicate.number}`);
      }
    }
    partner.updateProfile(input);
    await this.commit(partner);
    return partner;
  }

  async addContact(ctx: TenantContext, id: Ulid, input: AddContactInput): Promise<PartnerContact> {
    const partner = await this.get(ctx, id);
    const contact = partner.addContact(input);
    await this.commit(partner);
    return contact;
  }

  async promoteContact(ctx: TenantContext, id: Ulid, contactId: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.promoteToPrimary(contactId);
    await this.commit(partner);
    return partner;
  }

  async removeContact(ctx: TenantContext, id: Ulid, contactId: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.removeContact(contactId);
    await this.commit(partner);
    return partner;
  }

  async addAddress(ctx: TenantContext, id: Ulid, input: AddAddressInput): Promise<PartnerAddress> {
    const partner = await this.get(ctx, id);
    const address = partner.addAddress(input);
    await this.commit(partner);
    return address;
  }

  async removeAddress(ctx: TenantContext, id: Ulid, addressId: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.removeAddress(addressId);
    await this.commit(partner);
    return partner;
  }

  async addTerritory(ctx: TenantContext, id: Ulid, code: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.addTerritory(code);
    await this.commit(partner);
    return partner;
  }

  async removeTerritory(ctx: TenantContext, id: Ulid, code: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.removeTerritory(code);
    await this.commit(partner);
    return partner;
  }

  // --- onboarding ------------------------------------------------------------

  async submitApplication(ctx: TenantContext, id: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.submitApplication(this.clock.now());
    await this.commit(partner);
    return partner;
  }

  async startReview(ctx: TenantContext, id: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.startReview(this.clock.now(), ctx.userId);
    await this.commit(partner);
    return partner;
  }

  async approve(ctx: TenantContext, id: Ulid, notes?: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.approve(this.clock.now(), ctx.userId, notes);
    await this.commit(partner);
    return partner;
  }

  async reject(ctx: TenantContext, id: Ulid, reason: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.reject(this.clock.now(), ctx.userId, reason);
    await this.commit(partner);
    return partner;
  }

  /** Go-live: refuses to flip the switch without a live trading contract. */
  async activate(ctx: TenantContext, id: Ulid): Promise<Partner> {
    const partner = await this.get(ctx, id);
    const now = this.clock.now();
    const contracts = await this.contracts.byPartner(ctx.tenantId, partner.id);
    const trading = contracts.filter(
      (c) => TRADING_CONTRACT_TYPES.includes(c.type) && c.isEffectiveAt(now),
    );
    if (trading.length === 0) {
      throw new InvalidStateError(
        `${partner.number} has no effective trading contract; activate a reseller, distribution, msp or referral agreement first`,
      );
    }
    partner.activate(now, ctx.userId);
    await this.commit(partner);
    return partner;
  }

  async suspend(ctx: TenantContext, id: Ulid, reason: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.suspend(this.clock.now(), ctx.userId, reason);
    await this.commit(partner);
    return partner;
  }

  async reinstate(ctx: TenantContext, id: Ulid, note?: string): Promise<Partner> {
    const partner = await this.get(ctx, id);
    partner.reinstate(ctx.userId, note);
    await this.commit(partner);
    return partner;
  }

  /**
   * Terminates the relationship. Live contracts must be dealt with first;
   * `terminateContracts` does it in the same call so the two never drift.
   */
  async terminate(
    ctx: TenantContext,
    id: Ulid,
    input: { readonly reason: string; readonly terminateContracts?: boolean },
  ): Promise<Partner> {
    const partner = await this.get(ctx, id);
    const now = this.clock.now();
    const contracts = await this.contracts.byPartner(ctx.tenantId, partner.id);
    const live = contracts.filter((c) => c.status === "active" || c.status === "pending_signature");
    if (live.length > 0 && !input.terminateContracts) {
      throw new InvalidStateError(
        `${partner.number} still has ${live.length} live contract(s): ${live.map((c) => c.number).join(", ")}`,
        { contracts: live.map((c) => ({ id: c.id, number: c.number, status: c.status })) },
      );
    }
    for (const contract of live) {
      contract.terminate({ at: now, by: ctx.userId, reason: `Partner terminated: ${input.reason}` });
      await this.contracts.save(contract);
      await this.outbox.publish(contract.pullEvents());
    }
    partner.terminate(now, ctx.userId, input.reason);
    await this.commit(partner);
    return partner;
  }

  // --- performance -----------------------------------------------------------

  /** Upserts one period's numbers; re-reporting a period replaces it. */
  async recordPerformance(
    ctx: TenantContext,
    id: Ulid,
    command: RecordPerformanceCommand,
  ): Promise<PerformanceSnapshot> {
    const partner = await this.get(ctx, id);
    if (command.bookedRevenue.currency !== partner.currency) {
      throw ValidationError.single(
        "bookedRevenue.currency",
        `must match the partner's ${partner.currency} reporting currency`,
      );
    }
    const snapshot = recordPerformanceSnapshot(ctx.tenantId, {
      ...command,
      partnerId: partner.id,
      at: this.clock.now(),
    });
    await this.performance.save(snapshot);
    await this.outbox.publish([
      envelope({
        eventType: PrmEventTypes.PartnerPerformanceRecorded,
        aggregateType: "Partner",
        aggregateId: partner.id,
        tenantId: ctx.tenantId,
        payload: {
          partnerId: partner.id,
          period: snapshot.period,
          bookedRevenue: snapshot.bookedRevenue,
          dealsRegistered: snapshot.dealsRegistered,
          dealsWon: snapshot.dealsWon,
        },
      }),
    ]);
    return snapshot;
  }

  async trailingPerformance(ctx: TenantContext, id: Ulid, months = 12): Promise<TrailingPerformance> {
    const partner = await this.get(ctx, id);
    const snapshots = await this.performance.byPartner(ctx.tenantId, partner.id);
    return trailingPerformance(snapshots, this.clock.now(), partner.currency, months);
  }

  /** Whole months since activation; 0 for partners that never went live. */
  async monthsActive(ctx: TenantContext, id: Ulid): Promise<number> {
    const partner = await this.get(ctx, id);
    if (!partner.activatedAt) return 0;
    return Math.max(0, monthsBetween(partner.activatedAt, this.clock.now()));
  }

  private async commit(partner: Partner): Promise<void> {
    await this.partners.save(partner);
    await this.outbox.publish(partner.pullEvents());
  }
}

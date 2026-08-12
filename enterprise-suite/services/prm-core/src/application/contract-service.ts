import {
  ConflictError,
  NotFoundError,
  normalizePage,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  PartnerContract,
  TRADING_CONTRACT_TYPES,
  type ContractAmendment,
  type ContractObligation,
  type ContractType,
  type CreateContractInput,
  type DiscountLine,
  type ObligationStatus,
  type SignatureParty,
  type UpdateContractTermsInput,
} from "../domain/contract.js";
import { InvalidStateError } from "../domain/errors.js";
import type {
  Clock,
  ContractFilter,
  ContractRepository,
  OutboxPort,
  PartnerRepository,
  SequenceRepository,
} from "./ports.js";

export interface DraftContractCommand extends Omit<CreateContractInput, "number" | "partnerId"> {
  readonly partnerId: Ulid;
}

export interface SignContractCommand {
  readonly party: SignatureParty;
  readonly signatoryName: string;
  readonly signatoryEmail: string;
  readonly signatoryTitle?: string;
}

export interface AmendContractCommand {
  readonly summary: string;
  readonly effectiveFrom: IsoDateTime;
  readonly baseDiscountBps?: number;
  readonly effectiveTo?: IsoDateTime;
}

export interface ContractSweepResult {
  readonly renewed: readonly string[];
  readonly expired: readonly string[];
}

/**
 * Contract use cases.
 *
 * Cross-aggregate rules live here: a partner may hold only one *effective*
 * trading contract at a time (NDAs and MDF terms may coexist), contracts
 * cannot be drafted for terminated partners, and the periodic sweep decides
 * per contract whether the end of term means auto-renewal or expiry.
 */
export class ContractService {
  constructor(
    private readonly contracts: ContractRepository,
    private readonly partners: PartnerRepository,
    private readonly sequences: SequenceRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  async draft(ctx: TenantContext, command: DraftContractCommand): Promise<PartnerContract> {
    const partner = await this.partners.byId(ctx.tenantId, command.partnerId);
    if (!partner) throw new NotFoundError("Partner", command.partnerId);
    if (partner.status === "terminated" || partner.status === "rejected") {
      throw new InvalidStateError(`${partner.number} is ${partner.status}; no new contracts can be drafted`);
    }
    const existing = await this.contracts.byPartner(ctx.tenantId, partner.id);
    const openSameType = existing.filter(
      (c) => c.type === command.type && (c.status === "draft" || c.status === "pending_signature"),
    );
    if (openSameType.length > 0) {
      throw new ConflictError(
        `${partner.number} already has an open ${command.type} contract (${openSameType[0]!.number})`,
      );
    }
    const sequence = await this.sequences.next(ctx.tenantId, "contract");
    const contract = PartnerContract.create(ctx.tenantId, {
      ...command,
      currency: command.currency || partner.currency,
      number: `PCT-${String(sequence).padStart(5, "0")}`,
    });
    await this.commit(contract);
    return contract;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<PartnerContract> {
    const contract = await this.contracts.byId(ctx.tenantId, id);
    if (!contract) throw new NotFoundError("PartnerContract", id);
    return contract;
  }

  async list(
    ctx: TenantContext,
    filter: ContractFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<PartnerContract>> {
    return this.contracts.list(ctx.tenantId, filter, normalizePage(page));
  }

  async forPartner(ctx: TenantContext, partnerId: Ulid): Promise<readonly PartnerContract[]> {
    return this.contracts.byPartner(ctx.tenantId, partnerId);
  }

  /** Contracts that are active *and* inside their term right now. */
  async effectiveForPartner(ctx: TenantContext, partnerId: Ulid): Promise<readonly PartnerContract[]> {
    const now = this.clock.now();
    const contracts = await this.contracts.byPartner(ctx.tenantId, partnerId);
    return contracts.filter((c) => c.isEffectiveAt(now));
  }

  async activeTypesForPartner(ctx: TenantContext, partnerId: Ulid): Promise<readonly ContractType[]> {
    const effective = await this.effectiveForPartner(ctx, partnerId);
    return [...new Set(effective.map((c) => c.type))];
  }

  // --- drafting --------------------------------------------------------------

  async updateTerms(ctx: TenantContext, id: Ulid, input: UpdateContractTermsInput): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.updateTerms(input);
    await this.commit(contract);
    return contract;
  }

  async addDiscountLine(
    ctx: TenantContext,
    id: Ulid,
    input: Parameters<PartnerContract["addDiscountLine"]>[0],
  ): Promise<DiscountLine> {
    const contract = await this.get(ctx, id);
    const line = contract.addDiscountLine(input);
    await this.commit(contract);
    return line;
  }

  async removeDiscountLine(ctx: TenantContext, id: Ulid, lineId: Ulid): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.removeDiscountLine(lineId);
    await this.commit(contract);
    return contract;
  }

  async addObligation(
    ctx: TenantContext,
    id: Ulid,
    input: { readonly code: string; readonly description: string; readonly dueAt?: IsoDateTime },
  ): Promise<ContractObligation> {
    const contract = await this.get(ctx, id);
    const obligation = contract.addObligation(input);
    await this.commit(contract);
    return obligation;
  }

  async recordObligation(
    ctx: TenantContext,
    id: Ulid,
    input: { readonly code: string; readonly status: Exclude<ObligationStatus, "pending">; readonly evidence?: string },
  ): Promise<ContractObligation> {
    const contract = await this.get(ctx, id);
    const obligation = contract.recordObligation({ ...input, at: this.clock.now(), by: ctx.userId });
    await this.commit(contract);
    return obligation;
  }

  // --- signature & lifecycle -------------------------------------------------

  async sendForSignature(ctx: TenantContext, id: Ulid): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.sendForSignature(this.clock.now());
    await this.commit(contract);
    return contract;
  }

  async sign(ctx: TenantContext, id: Ulid, command: SignContractCommand): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.sign({ ...command, at: this.clock.now(), by: ctx.userId });
    await this.commit(contract);
    return contract;
  }

  /** Activation is where the "one effective trading contract" rule bites. */
  async activate(ctx: TenantContext, id: Ulid): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    const now = this.clock.now();
    if (TRADING_CONTRACT_TYPES.includes(contract.type)) {
      const siblings = await this.contracts.byPartner(ctx.tenantId, contract.partnerId);
      const clash = siblings.find(
        (c) => c.id !== contract.id && TRADING_CONTRACT_TYPES.includes(c.type) && c.isEffectiveAt(now),
      );
      if (clash) {
        throw new ConflictError(
          `Contract ${clash.number} (${clash.type}) is already effective for this partner until ${clash.effectiveTo}`,
        );
      }
    }
    contract.activate(now);
    await this.commit(contract);
    return contract;
  }

  async cancel(ctx: TenantContext, id: Ulid, reason: string): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.cancel(reason);
    await this.commit(contract);
    return contract;
  }

  async amend(ctx: TenantContext, id: Ulid, command: AmendContractCommand): Promise<ContractAmendment> {
    const contract = await this.get(ctx, id);
    const amendment = contract.amend({ ...command, by: ctx.userId, at: this.clock.now() });
    await this.commit(contract);
    return amendment;
  }

  async renew(ctx: TenantContext, id: Ulid, months?: number): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.renew({ at: this.clock.now(), months, by: ctx.userId });
    await this.commit(contract);
    return contract;
  }

  async terminate(ctx: TenantContext, id: Ulid, reason: string): Promise<PartnerContract> {
    const contract = await this.get(ctx, id);
    contract.terminate({ at: this.clock.now(), by: ctx.userId, reason });
    await this.commit(contract);
    return contract;
  }

  /**
   * End-of-term sweep. Auto-renewing contracts in good standing roll forward;
   * everything else past its end date expires. Contracts with unmet
   * obligations are never auto-renewed — they expire and need a human.
   */
  async sweepExpiries(ctx: TenantContext, at?: IsoDateTime): Promise<ContractSweepResult> {
    const now = at ?? this.clock.now();
    const contracts = await this.contracts.all(ctx.tenantId);
    const renewed: string[] = [];
    const expired: string[] = [];
    for (const contract of contracts) {
      if (contract.status !== "active") continue;
      if (Date.parse(now) < Date.parse(contract.effectiveTo)) continue;
      if (contract.autoRenew && !contract.hasOpenObligations()) {
        contract.renew({ at: now, by: ctx.userId });
        renewed.push(contract.number);
      } else if (contract.expireIfDue(now)) {
        expired.push(contract.number);
      }
      await this.commit(contract);
    }
    return { renewed, expired };
  }

  private async commit(contract: PartnerContract): Promise<void> {
    await this.contracts.save(contract);
    await this.outbox.publish(contract.pullEvents());
  }
}

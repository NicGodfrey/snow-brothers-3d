import {
  NotFoundError,
  normalizePage,
  type IsoDateTime,
  type Money,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import { TRADING_CONTRACT_TYPES } from "../domain/contract.js";
import { periodContains, fiscalPeriod } from "../domain/dates.js";
import { BudgetExhaustedError, InvalidStateError, ValidationError } from "../domain/errors.js";
import type { MdfBudget } from "../domain/mdf-budget.js";
import { MdfClaim, type AddProofInput, type ProofOfPerformance } from "../domain/mdf-claim.js";
import { MdfRequest, type MdfActivityType, type UpdateMdfRequestInput } from "../domain/mdf-request.js";
import type {
  Clock,
  ContractRepository,
  MdfBudgetRepository,
  MdfClaimFilter,
  MdfClaimRepository,
  MdfRequestFilter,
  MdfRequestRepository,
  OutboxPort,
  PartnerRepository,
  SequenceRepository,
  TierDefinitionRepository,
} from "./ports.js";

export interface CreateFundRequestCommand {
  readonly partnerId: Ulid;
  readonly budgetId: Ulid;
  readonly activityType: MdfActivityType;
  readonly title: string;
  readonly description: string;
  readonly activityStart: IsoDateTime;
  readonly activityEnd: IsoDateTime;
  readonly requestedAmount: Money;
  readonly expectedLeads?: number;
  readonly expectedPipeline?: Money;
}

export interface ApproveFundRequestCommand {
  readonly approvedAmount?: Money;
  readonly notes?: string;
}

export interface CreateClaimCommand {
  readonly requestId: Ulid;
  readonly claimedAmount: Money;
  readonly activitySummary?: string;
  readonly actualLeads?: number;
  readonly actualPipeline?: Money;
}

export interface MdfEligibility {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly requestCapBps: number;
}

/**
 * MDF request and claim workflows — the part that moves money.
 *
 * Every state change that touches the ledger does so through the budget
 * aggregate, and always *after* the request/claim aggregate has accepted the
 * command, so a rejected workflow transition can never leave money committed.
 * Availability is pre-checked before mutating anything, which keeps the
 * in-memory and SQL adapters equivalent (no half-applied command).
 */
export class MdfService {
  constructor(
    private readonly budgets: MdfBudgetRepository,
    private readonly requests: MdfRequestRepository,
    private readonly claims: MdfClaimRepository,
    private readonly partners: PartnerRepository,
    private readonly contracts: ContractRepository,
    private readonly tiers: TierDefinitionRepository,
    private readonly sequences: SequenceRepository,
    private readonly outbox: OutboxPort,
    private readonly clock: Clock,
  ) {}

  /**
   * MDF is a contractual benefit: the partner must be trading, have an
   * MDF-eligible contract or an accruing tier, and hold an allocation.
   */
  async eligibility(ctx: TenantContext, partnerId: Ulid): Promise<MdfEligibility> {
    const partner = await this.partners.byId(ctx.tenantId, partnerId);
    if (!partner) throw new NotFoundError("Partner", partnerId);
    const now = this.clock.now();
    const reasons: string[] = [];
    if (partner.status !== "active") reasons.push(`partner is ${partner.status}`);

    const contracts = await this.contracts.byPartner(ctx.tenantId, partner.id);
    const effective = contracts.filter((c) => c.isEffectiveAt(now));
    const mdfContract = effective.find(
      (c) => c.mdfEligible && (TRADING_CONTRACT_TYPES.includes(c.type) || c.type === "mdf_terms"),
    );
    const tier = partner.tierCode ? await this.tiers.byCode(ctx.tenantId, partner.tierCode) : undefined;
    const tierAccrues = (tier?.benefits.mdfAccrualBps ?? 0) > 0;
    if (!mdfContract && !tierAccrues) {
      reasons.push("no MDF-eligible contract and the tier does not accrue MDF");
    }
    return {
      eligible: reasons.length === 0,
      reasons,
      requestCapBps: tier?.benefits.mdfRequestCapBps ?? 10_000,
    };
  }

  // --- fund requests ---------------------------------------------------------

  async createRequest(ctx: TenantContext, command: CreateFundRequestCommand): Promise<MdfRequest> {
    const eligibility = await this.eligibility(ctx, command.partnerId);
    if (!eligibility.eligible) {
      throw new InvalidStateError(`Partner is not eligible for MDF: ${eligibility.reasons.join("; ")}`, {
        reasons: eligibility.reasons,
      });
    }
    const budget = await this.requireBudget(ctx, command.budgetId);
    if (budget.status !== "open") {
      throw new InvalidStateError(`Budget ${budget.code} is ${budget.status}`);
    }
    const allocation = budget.allocationForPartner(command.partnerId);
    if (!allocation) {
      throw new InvalidStateError(`Partner has no allocation in budget ${budget.code}`);
    }
    const period = fiscalPeriod(budget.period);
    if (!periodContains(period, command.activityStart)) {
      throw ValidationError.single(
        "activityStart",
        `must fall inside ${budget.period} (${period.start} – ${period.end})`,
      );
    }
    const available = budget.allocationAvailable(allocation.id);
    if (command.requestedAmount.amountMinor > available.amountMinor) {
      throw new BudgetExhaustedError(
        `Allocation in ${budget.code}`,
        command.requestedAmount.amountMinor,
        available.amountMinor,
        budget.currency,
      );
    }
    const cap = budget.requestCap(allocation.id, eligibility.requestCapBps);
    if (command.requestedAmount.amountMinor > cap.amountMinor) {
      throw new InvalidStateError(
        `A single request may not exceed ${cap.amountMinor} ${budget.currency} at this tier`,
        { cap, requested: command.requestedAmount },
      );
    }

    const sequence = await this.sequences.next(ctx.tenantId, "mdf-request");
    const request = MdfRequest.create(ctx.tenantId, {
      ...command,
      allocationId: allocation.id,
      matchingRateBps: budget.matchingRateBps,
      number: `MDF-${String(sequence).padStart(5, "0")}`,
    });
    await this.commitRequest(request);
    return request;
  }

  async getRequest(ctx: TenantContext, id: Ulid): Promise<MdfRequest> {
    const request = await this.requests.byId(ctx.tenantId, id);
    if (!request) throw new NotFoundError("MdfRequest", id);
    return request;
  }

  async listRequests(
    ctx: TenantContext,
    filter: MdfRequestFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<MdfRequest>> {
    return this.requests.list(ctx.tenantId, filter, normalizePage(page));
  }

  async updateRequest(ctx: TenantContext, id: Ulid, input: UpdateMdfRequestInput): Promise<MdfRequest> {
    const request = await this.getRequest(ctx, id);
    request.update(input);
    await this.commitRequest(request);
    return request;
  }

  async submitRequest(ctx: TenantContext, id: Ulid): Promise<MdfRequest> {
    const request = await this.getRequest(ctx, id);
    request.submit(this.clock.now(), ctx.userId);
    await this.commitRequest(request);
    return request;
  }

  /** Approval commits budget money; availability is checked before anything mutates. */
  async approveRequest(
    ctx: TenantContext,
    id: Ulid,
    command: ApproveFundRequestCommand = {},
  ): Promise<MdfRequest> {
    const request = await this.getRequest(ctx, id);
    const budget = await this.requireBudget(ctx, request.budgetId);
    const wanted = command.approvedAmount ?? request.requestedAmount;
    const available = budget.allocationAvailable(request.allocationId);
    if (wanted.amountMinor > available.amountMinor) {
      throw new BudgetExhaustedError(
        `Allocation in ${budget.code}`,
        wanted.amountMinor,
        available.amountMinor,
        budget.currency,
      );
    }
    const approved = request.approve({
      at: this.clock.now(),
      by: ctx.userId,
      approvedAmount: command.approvedAmount,
      claimWindowDays: budget.claimWindowDays,
      notes: command.notes,
    });
    budget.commit(request.allocationId, approved, request.id);
    await this.commitRequest(request);
    await this.commitBudget(budget);
    return request;
  }

  async rejectRequest(ctx: TenantContext, id: Ulid, reason: string): Promise<MdfRequest> {
    const request = await this.getRequest(ctx, id);
    request.reject({ at: this.clock.now(), by: ctx.userId, reason });
    await this.commitRequest(request);
    return request;
  }

  async cancelRequest(ctx: TenantContext, id: Ulid, reason: string): Promise<MdfRequest> {
    const request = await this.getRequest(ctx, id);
    request.cancel(reason);
    await this.commitRequest(request);
    return request;
  }

  /**
   * Closes the envelope and returns the unclaimed remainder to the allocation.
   * Refused while claims are still in flight, otherwise the release would
   * double-count money a reviewer is about to approve.
   */
  async closeRequest(ctx: TenantContext, id: Ulid, reason: string): Promise<MdfRequest> {
    const request = await this.getRequest(ctx, id);
    const claims = await this.claims.byRequest(ctx.tenantId, request.id);
    const inFlight = claims.filter(
      (c) => c.status === "submitted" || c.status === "in_review" || c.status === "approved",
    );
    if (inFlight.length > 0) {
      throw new InvalidStateError(
        `${inFlight.length} claim(s) are still open on ${request.number}: ${inFlight.map((c) => c.number).join(", ")}`,
      );
    }
    const budget = await this.requireBudget(ctx, request.budgetId);
    const remaining = request.close(this.clock.now(), reason);
    if (remaining.amountMinor > 0) {
      budget.releaseCommitment(request.allocationId, remaining, request.id);
      await this.commitBudget(budget);
    }
    await this.commitRequest(request);
    return request;
  }

  // --- claims ----------------------------------------------------------------

  async createClaim(ctx: TenantContext, command: CreateClaimCommand): Promise<MdfClaim> {
    const request = await this.getRequest(ctx, command.requestId);
    if (request.status !== "approved") {
      throw new InvalidStateError(`Fund request ${request.number} is ${request.status}; claims need an approval`);
    }
    const remaining = request.claimableRemaining();
    if (command.claimedAmount.amountMinor > remaining.amountMinor) {
      throw new InvalidStateError(
        `Only ${remaining.amountMinor} ${request.currency} is still claimable on ${request.number}`,
        { remaining, claimed: command.claimedAmount },
      );
    }
    const sequence = await this.sequences.next(ctx.tenantId, "mdf-claim");
    const claim = MdfClaim.create(ctx.tenantId, {
      number: `CLM-${String(sequence).padStart(5, "0")}`,
      requestId: request.id,
      partnerId: request.partnerId,
      budgetId: request.budgetId,
      allocationId: request.allocationId,
      claimedAmount: command.claimedAmount,
      activitySummary: command.activitySummary,
      actualLeads: command.actualLeads,
      actualPipeline: command.actualPipeline,
    });
    await this.commitClaim(claim);
    return claim;
  }

  async getClaim(ctx: TenantContext, id: Ulid): Promise<MdfClaim> {
    const claim = await this.claims.byId(ctx.tenantId, id);
    if (!claim) throw new NotFoundError("MdfClaim", id);
    return claim;
  }

  async listClaims(ctx: TenantContext, filter: MdfClaimFilter, page?: Partial<PageRequest>): Promise<Page<MdfClaim>> {
    return this.claims.list(ctx.tenantId, filter, normalizePage(page));
  }

  async addProof(
    ctx: TenantContext,
    id: Ulid,
    input: Omit<AddProofInput, "at" | "by">,
  ): Promise<ProofOfPerformance> {
    const claim = await this.getClaim(ctx, id);
    const proof = claim.addProof({ ...input, at: this.clock.now(), by: ctx.userId });
    await this.commitClaim(claim);
    return proof;
  }

  async removeProof(ctx: TenantContext, id: Ulid, proofId: Ulid): Promise<MdfClaim> {
    const claim = await this.getClaim(ctx, id);
    claim.removeProof(proofId);
    await this.commitClaim(claim);
    return claim;
  }

  /** Submission is where the claim window is enforced. */
  async submitClaim(ctx: TenantContext, id: Ulid): Promise<MdfClaim> {
    const claim = await this.getClaim(ctx, id);
    const request = await this.getRequest(ctx, claim.requestId);
    if (!request.claimDeadline) {
      throw new InvalidStateError(`Fund request ${request.number} has no claim deadline`);
    }
    claim.submit({ at: this.clock.now(), by: ctx.userId, deadline: request.claimDeadline });
    await this.commitClaim(claim);
    return claim;
  }

  async startClaimReview(ctx: TenantContext, id: Ulid): Promise<MdfClaim> {
    const claim = await this.getClaim(ctx, id);
    claim.startReview(this.clock.now(), ctx.userId);
    await this.commitClaim(claim);
    return claim;
  }

  async approveClaim(
    ctx: TenantContext,
    id: Ulid,
    command: { readonly approvedAmount?: Money; readonly notes?: string } = {},
  ): Promise<MdfClaim> {
    const claim = await this.getClaim(ctx, id);
    const request = await this.getRequest(ctx, claim.requestId);
    const approved = claim.approve({
      at: this.clock.now(),
      by: ctx.userId,
      approvedAmount: command.approvedAmount,
      cap: request.claimableRemaining(),
      notes: command.notes,
    });
    request.recordClaimApproved(approved);
    await this.commitClaim(claim);
    await this.commitRequest(request);
    return claim;
  }

  async rejectClaim(ctx: TenantContext, id: Ulid, reason: string): Promise<MdfClaim> {
    const claim = await this.getClaim(ctx, id);
    claim.reject({ at: this.clock.now(), by: ctx.userId, reason });
    await this.commitClaim(claim);
    return claim;
  }

  /** Payment settles the ledger: the committed money becomes paid money. */
  async payClaim(ctx: TenantContext, id: Ulid, reference: string): Promise<MdfClaim> {
    const claim = await this.getClaim(ctx, id);
    const budget = await this.requireBudget(ctx, claim.budgetId);
    const amount = claim.pay({ at: this.clock.now(), reference });
    budget.settle(claim.allocationId, amount, claim.id);
    await this.commitClaim(claim);
    await this.commitBudget(budget);
    return claim;
  }

  private async requireBudget(ctx: TenantContext, id: Ulid): Promise<MdfBudget> {
    const budget = await this.budgets.byId(ctx.tenantId, id);
    if (!budget) throw new NotFoundError("MdfBudget", id);
    return budget;
  }

  private async commitRequest(request: MdfRequest): Promise<void> {
    await this.requests.save(request);
    await this.outbox.publish(request.pullEvents());
  }

  private async commitClaim(claim: MdfClaim): Promise<void> {
    await this.claims.save(claim);
    await this.outbox.publish(claim.pullEvents());
  }

  private async commitBudget(budget: MdfBudget): Promise<void> {
    await this.budgets.save(budget);
    await this.outbox.publish(budget.pullEvents());
  }
}

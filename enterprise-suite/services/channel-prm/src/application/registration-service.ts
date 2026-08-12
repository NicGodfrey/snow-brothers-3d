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
import type { ConflictCase, ConflictFinding } from "../domain/conflict.js";
import { hasBlockingFinding } from "../domain/conflict.js";
import {
  DealRegistration,
  type DealSource,
  type DocumentLink,
  type LossReason,
  type RejectionReason,
} from "../domain/deal-registration.js";
import { DealConflictError, InvalidStateError, PolicyViolationError } from "../domain/errors.js";
import { formatNumber } from "../domain/numbering.js";
import type { Partner, TierPolicy } from "../domain/partner.js";
import { customerKey, validateEndCustomer, type EndCustomer } from "../domain/territory.js";
import type { ChannelStage } from "../domain/stages.js";
import type { ConflictService } from "./conflict-service.js";
import type { PartnerService } from "./partner-service.js";
import type { Clock, OutboxPort, RegistrationFilter, RegistrationRepository, SequencePort } from "./ports.js";
import { Publisher } from "./unit-of-work.js";

export interface CreateRegistrationCommand {
  readonly partnerId: Ulid;
  readonly endCustomer: EndCustomer;
  readonly productLines: readonly string[];
  readonly estimatedValue: Money;
  readonly expectedCloseDate: IsoDateTime;
  readonly source?: DealSource;
  readonly stage?: ChannelStage;
  readonly probability?: number;
  readonly description?: string;
  readonly competitors?: readonly string[];
  readonly referralId?: Ulid;
}

export interface ApproveRegistrationCommand {
  readonly protectionDays?: number;
  readonly discountBps?: number;
  readonly notes?: string;
}

export interface SubmitResult {
  readonly registration: DealRegistration;
  readonly findings: readonly ConflictFinding[];
  readonly conflicts: readonly ConflictCase[];
  readonly autoApproved: boolean;
}

export interface PrecheckResult {
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly customerKey: string;
  readonly findings: readonly ConflictFinding[];
  readonly blocked: boolean;
  readonly protectionDays: number;
  readonly discountBps: number;
  readonly autoApprovalLikely: boolean;
}

/**
 * Deal registration use cases.
 *
 * The aggregate owns the state machine; this service owns everything that
 * needs more than one aggregate: partner eligibility, conflict detection at
 * submission, tier-driven protection and discount, and auto-approval of small
 * clean deals.
 */
export class RegistrationService {
  private readonly publisher: Publisher;

  constructor(
    private readonly registrations: RegistrationRepository,
    private readonly partnerService: PartnerService,
    private readonly conflictService: ConflictService,
    private readonly sequences: SequencePort,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  /**
   * Dry-run used by the partner portal before a partner invests time in a
   * registration form: same eligibility and conflict logic as submission, no
   * writes and no conflict cases.
   */
  async precheck(
    ctx: TenantContext,
    input: { partnerId: Ulid; endCustomer: EndCustomer; productLines: readonly string[]; estimatedValue?: Money },
  ): Promise<PrecheckResult> {
    const partner = await this.partnerService.get(ctx, input.partnerId);
    const policy = await this.partnerService.policyFor(ctx, partner.tier);
    const endCustomer = validateEndCustomer(input.endCustomer);
    const key = customerKey(endCustomer);
    const eligibility = this.partnerService.eligibility(partner, {
      country: endCustomer.country,
      productLines: input.productLines,
    });
    const findings = await this.conflictService.detect(ctx, {
      partnerId: partner.id,
      customerKey: key,
      productLines: input.productLines,
      protectionDays: policy.protectionDays,
    });
    const blocked = hasBlockingFinding(findings);
    const smallEnough =
      input.estimatedValue !== undefined && input.estimatedValue.amountMinor < policy.autoApproveBelowMinor;
    return {
      eligible: eligibility.eligible,
      reasons: eligibility.reasons,
      customerKey: key,
      findings,
      blocked,
      protectionDays: policy.protectionDays,
      discountBps: policy.registeredDiscountBps,
      autoApprovalLikely: eligibility.eligible && !blocked && findings.length === 0 && smallEnough,
    };
  }

  async create(ctx: TenantContext, command: CreateRegistrationCommand): Promise<DealRegistration> {
    const partner = await this.partnerService.get(ctx, command.partnerId);
    const endCustomer = validateEndCustomer(command.endCustomer);
    this.partnerService.assertCanRegister(partner, {
      country: endCustomer.country,
      productLines: command.productLines,
    });
    if (!partner.canTransact && (command.source ?? "partner_sourced") !== "vendor_referred") {
      throw new PolicyViolationError(
        `Partner ${partner.code} is a referral agent; submit an opportunity referral instead of a deal registration`,
        "partner.type",
        { type: partner.type },
      );
    }
    if (command.estimatedValue.currency !== partner.currency) {
      throw new PolicyViolationError(
        `Deal value must be in ${partner.currency}, the partner's transaction currency`,
        "partner.currency",
        { expected: partner.currency, actual: command.estimatedValue.currency },
      );
    }

    const now = this.clock.now();
    const registration = DealRegistration.create(ctx.tenantId, {
      ...command,
      endCustomer,
      number: formatNumber("dealRegistration", await this.sequences.next(ctx.tenantId, "dealRegistration")),
      createdBy: ctx.userId,
      createdAt: now,
    });
    await this.registrations.save(registration);
    await this.publisher.publish(registration);
    return registration;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<DealRegistration> {
    const registration = await this.registrations.byId(ctx.tenantId, id);
    if (!registration) throw new NotFoundError("DealRegistration", id);
    return registration;
  }

  async getByNumber(ctx: TenantContext, number: string): Promise<DealRegistration> {
    const registration = await this.registrations.byNumber(ctx.tenantId, number);
    if (!registration) throw new NotFoundError("DealRegistration", number);
    return registration;
  }

  async list(
    ctx: TenantContext,
    filter: RegistrationFilter,
    page?: Partial<PageRequest>,
  ): Promise<Page<DealRegistration>> {
    return this.registrations.list(ctx.tenantId, { at: this.clock.now(), ...filter }, normalizePage(page));
  }

  async updateDetails(
    ctx: TenantContext,
    id: Ulid,
    input: {
      estimatedValue?: Money;
      expectedCloseDate?: IsoDateTime;
      description?: string;
      competitors?: readonly string[];
      productLines?: readonly string[];
    },
  ): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    if (input.productLines) {
      const partner = await this.partnerService.get(ctx, registration.partnerId);
      this.partnerService.assertCanRegister(partner, {
        country: registration.endCustomer.country,
        productLines: input.productLines,
        action: "change product lines",
      });
    }
    registration.updateDetails(input, ctx.userId, this.clock.now());
    return this.commit(registration);
  }

  /**
   * Submits for review, running conflict detection first.
   *
   * Duplicates of the partner's own registration and house-account collisions
   * are refused outright — there is nothing to adjudicate. A collision with
   * another partner's live protection *is* submitted, but it opens a conflict
   * case and blocks auto-approval; a human decides who owns the customer.
   *
   * A clean, small deal from an eligible partner is approved in the same call.
   */
  async submit(ctx: TenantContext, id: Ulid): Promise<SubmitResult> {
    const registration = await this.get(ctx, id);
    const partner = await this.partnerService.get(ctx, registration.partnerId);
    partner.assertActive("submit registrations");
    const policy = await this.partnerService.policyFor(ctx, partner.tier);

    const findings = await this.conflictService.detect(ctx, {
      partnerId: registration.partnerId,
      customerKey: registration.customerKey,
      productLines: registration.productLines,
      protectionDays: policy.protectionDays,
      excludeRegistrationId: registration.id,
    });

    const refusals = findings.filter(
      (f) => f.severity === "blocking" && (f.kind === "duplicate_registration" || f.kind === "partner_vs_direct"),
    );
    if (refusals.length > 0) {
      throw new DealConflictError(
        `Registration ${registration.number} cannot be submitted: ${refusals[0]!.explanation}`,
        refusals,
      );
    }

    registration.submit(ctx.userId, this.clock.now(), policy.approvalSlaHours);
    await this.registrations.save(registration);
    await this.publisher.publish(registration);

    const conflicts: ConflictCase[] = [];
    for (const finding of findings) {
      conflicts.push(await this.conflictService.raiseCase(ctx, registration, finding));
    }

    let autoApproved = false;
    if (
      conflicts.length === 0 &&
      registration.estimatedValue.amountMinor < policy.autoApproveBelowMinor &&
      partner.coversTerritory(registration.endCustomer.country) &&
      partner.unauthorizedProductLines(registration.productLines).length === 0
    ) {
      await this.applyApproval(ctx, registration, partner, policy, {
        autoApproved: true,
        notes: `Auto-approved: below the ${partner.tier} tier threshold with no conflicts`,
      });
      autoApproved = true;
    }

    return { registration, findings, conflicts, autoApproved };
  }

  async startReview(ctx: TenantContext, id: Ulid): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.startReview(ctx.userId, this.clock.now());
    return this.commit(registration);
  }

  /**
   * Approves and mints the protection window. Refuses while a conflict case is
   * open — approving both sides of a live conflict is exactly the mistake the
   * case exists to prevent. Protection may be shortened at the reviewer's
   * discretion but never stretched past the tier's grant plus its extension
   * head-room.
   */
  async approve(ctx: TenantContext, id: Ulid, command: ApproveRegistrationCommand = {}): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    if (await this.conflictService.hasOpenCase(ctx, registration.id)) {
      throw new InvalidStateError(
        `Registration ${registration.number} has an open conflict case; resolve it before approving`,
      );
    }
    const partner = await this.partnerService.get(ctx, registration.partnerId);
    const policy = await this.partnerService.policyFor(ctx, partner.tier);
    await this.applyApproval(ctx, registration, partner, policy, {
      protectionDays: command.protectionDays,
      discountBps: command.discountBps,
      notes: command.notes,
      autoApproved: false,
    });
    return registration;
  }

  async reject(
    ctx: TenantContext,
    id: Ulid,
    input: { reasonCode: RejectionReason; notes?: string },
  ): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.reject({ by: ctx.userId, at: this.clock.now(), reasonCode: input.reasonCode, notes: input.notes });
    return this.commit(registration);
  }

  async withdraw(ctx: TenantContext, id: Ulid, reason: string): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.withdraw(ctx.userId, this.clock.now(), reason);
    return this.commit(registration);
  }

  async updateForecast(
    ctx: TenantContext,
    id: Ulid,
    input: { stage?: ChannelStage; probability?: number; estimatedValue?: Money; expectedCloseDate?: IsoDateTime },
  ): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.updateForecast(input, ctx.userId, this.clock.now());
    return this.commit(registration);
  }

  async extendProtection(
    ctx: TenantContext,
    id: Ulid,
    input: { days: number; reason: string },
  ): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    const partner = await this.partnerService.get(ctx, registration.partnerId);
    const policy = await this.partnerService.policyFor(ctx, registration.tierAtApproval ?? partner.tier);
    registration.extendProtection({
      days: input.days,
      reason: input.reason,
      by: ctx.userId,
      at: this.clock.now(),
      policy: {
        maxExtensionDays: policy.maxExtensionDays,
        maxExtensions: policy.maxExtensions,
        renewalGraceDays: policy.renewalGraceDays,
      },
    });
    return this.commit(registration);
  }

  async markWon(ctx: TenantContext, id: Ulid, input: { value: Money; notes?: string }): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.markWon({ by: ctx.userId, at: this.clock.now(), value: input.value, reason: input.notes });
    return this.commit(registration);
  }

  async markLost(
    ctx: TenantContext,
    id: Ulid,
    input: { reason: LossReason; competitor?: string; notes?: string },
  ): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.markLost({
      by: ctx.userId,
      at: this.clock.now(),
      reason: input.reason,
      competitor: input.competitor,
      notes: input.notes,
    });
    return this.commit(registration);
  }

  /** Manual counterpart of the expiry sweep, for a single registration. */
  async expire(ctx: TenantContext, id: Ulid): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    if (!registration.expire(this.clock.now())) {
      throw new InvalidStateError(
        `Registration ${registration.number} is ${registration.status} and its protection has not lapsed`,
      );
    }
    return this.commit(registration);
  }

  async linkQuote(ctx: TenantContext, id: Ulid, link: DocumentLink): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.linkQuote(link);
    return this.commit(registration);
  }

  async linkOrder(ctx: TenantContext, id: Ulid, link: DocumentLink): Promise<DealRegistration> {
    const registration = await this.get(ctx, id);
    registration.linkOrder(link);
    return this.commit(registration);
  }

  /** Registrations holding live protection over a customer at `at`. */
  async protectedRegistrations(ctx: TenantContext, at?: IsoDateTime): Promise<readonly DealRegistration[]> {
    return this.registrations.protectedAt(ctx.tenantId, at ?? this.clock.now());
  }

  private async applyApproval(
    ctx: TenantContext,
    registration: DealRegistration,
    partner: Partner,
    policy: TierPolicy,
    options: { protectionDays?: number; discountBps?: number; notes?: string; autoApproved: boolean },
  ): Promise<void> {
    const maxDays = policy.protectionDays + policy.maxExtensionDays;
    const days = options.protectionDays ?? policy.protectionDays;
    if (days > maxDays) {
      throw new PolicyViolationError(
        `${days} days of protection exceeds the ${partner.tier} ceiling of ${maxDays} days ` +
          `(${policy.protectionDays} granted + ${policy.maxExtensionDays} extension)`,
        "protection.grantCeiling",
        { requested: days, ceiling: maxDays },
      );
    }
    const discountBps = options.discountBps ?? policy.registeredDiscountBps;
    if (discountBps > policy.maxDiscountBps) {
      throw new PolicyViolationError(
        `Discount ${discountBps}bps exceeds the ${partner.tier} band of ${policy.maxDiscountBps}bps`,
        "partner.discountBand",
        { requested: discountBps, ceiling: policy.maxDiscountBps },
      );
    }
    registration.approve({
      by: ctx.userId,
      at: this.clock.now(),
      protectionDays: days,
      discountBps,
      tier: partner.tier,
      autoApproved: options.autoApproved,
      notes: options.notes,
    });
    await this.commit(registration);
  }

  private async commit(registration: DealRegistration): Promise<DealRegistration> {
    await this.registrations.save(registration);
    await this.publisher.publish(registration);
    return registration;
  }
}

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
import type { DealRegistration } from "../domain/deal-registration.js";
import { PolicyViolationError, ValidationError } from "../domain/errors.js";
import { sumMoney, zeroMoney } from "../domain/money-math.js";
import { formatNumber } from "../domain/numbering.js";
import {
  Referral,
  type ReferralCommission,
  type ReferralCompany,
  type ReferralContact,
  type ReferralRejectionReason,
} from "../domain/referral.js";
import type { PartnerService } from "./partner-service.js";
import type { Clock, OutboxPort, ReferralFilter, ReferralRepository, SequencePort } from "./ports.js";
import type { RegistrationService } from "./registration-service.js";
import { Publisher } from "./unit-of-work.js";

export interface SubmitReferralCommand {
  readonly partnerId: Ulid;
  readonly contact: ReferralContact;
  readonly company: ReferralCompany;
  readonly productLines: readonly string[];
  readonly estimatedValue?: Money;
  readonly notes?: string;
}

export interface AcceptReferralCommand {
  readonly attributionDays?: number;
  readonly commissionBps?: number;
}

export interface ConvertToRegistrationCommand {
  readonly estimatedValue: Money;
  readonly expectedCloseDate: IsoDateTime;
  readonly description: string;
  readonly productLines?: readonly string[];
  /** Partner that will transact, when it differs from the referring partner. */
  readonly transactingPartnerId?: Ulid;
}

export interface CommissionLedgerEntry {
  readonly partnerId: Ulid;
  readonly currency: string;
  readonly accrued: Money;
  readonly approved: Money;
  readonly paid: Money;
  readonly referralCount: number;
}

/** Days a referral may sit undecided before it lapses. */
const DECISION_SLA_DAYS = 10;

/** Attribution granted on acceptance when the caller does not override it. */
const DEFAULT_ATTRIBUTION_DAYS = 180;

/**
 * Opportunity referrals and the commission they earn.
 *
 * Referrals are the low-friction entry point into the channel: a partner hands
 * over a contact, the vendor decides quickly, and an accepted referral either
 * becomes a full deal registration (the partner transacts) or stays with the
 * vendor's own sellers while the partner keeps its attribution. Product-line
 * authorization is enforced; territory is not, because an introduction outside
 * a partner's patch is still a good introduction.
 */
export class ReferralService {
  private readonly publisher: Publisher;

  constructor(
    private readonly referrals: ReferralRepository,
    private readonly partnerService: PartnerService,
    private readonly registrationService: RegistrationService,
    private readonly sequences: SequencePort,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  async submit(ctx: TenantContext, command: SubmitReferralCommand): Promise<Referral> {
    const partner = await this.partnerService.get(ctx, command.partnerId);
    partner.assertActive("submit referrals");
    const unauthorized = partner.unauthorizedProductLines(command.productLines);
    if (unauthorized.length > 0) {
      throw new PolicyViolationError(
        `Partner ${partner.code} is not authorized for product line(s): ${unauthorized.join(", ")}`,
        "partner.productLine",
        { unauthorized, authorized: partner.productLines },
      );
    }
    if (command.estimatedValue && command.estimatedValue.currency !== partner.currency) {
      throw new PolicyViolationError(
        `Referral value must be in ${partner.currency}, the partner's transaction currency`,
        "partner.currency",
        { expected: partner.currency, actual: command.estimatedValue.currency },
      );
    }

    const referral = Referral.create(ctx.tenantId, {
      ...command,
      number: formatNumber("referral", await this.sequences.next(ctx.tenantId, "referral")),
      submittedBy: ctx.userId,
      submittedAt: this.clock.now(),
      decisionSlaDays: DECISION_SLA_DAYS,
    });
    return this.commit(referral);
  }

  async get(ctx: TenantContext, id: Ulid): Promise<Referral> {
    const referral = await this.referrals.byId(ctx.tenantId, id);
    if (!referral) throw new NotFoundError("Referral", id);
    return referral;
  }

  async list(ctx: TenantContext, filter: ReferralFilter, page?: Partial<PageRequest>): Promise<Page<Referral>> {
    return this.referrals.list(ctx.tenantId, filter, normalizePage(page));
  }

  async accept(ctx: TenantContext, id: Ulid, command: AcceptReferralCommand = {}): Promise<Referral> {
    const referral = await this.get(ctx, id);
    const partner = await this.partnerService.get(ctx, referral.partnerId);
    const policy = await this.partnerService.policyFor(ctx, partner.tier);
    const commissionBps = command.commissionBps ?? policy.referralCommissionBps;
    if (commissionBps > policy.referralCommissionBps) {
      throw new PolicyViolationError(
        `Commission ${commissionBps}bps exceeds the ${partner.tier} referral rate of ${policy.referralCommissionBps}bps`,
        "referral.commissionRate",
        { requested: commissionBps, ceiling: policy.referralCommissionBps },
      );
    }
    referral.accept({
      by: ctx.userId,
      at: this.clock.now(),
      attributionDays: command.attributionDays ?? DEFAULT_ATTRIBUTION_DAYS,
      commissionBps,
    });
    return this.commit(referral);
  }

  async reject(
    ctx: TenantContext,
    id: Ulid,
    input: { reason: ReferralRejectionReason; notes?: string },
  ): Promise<Referral> {
    const referral = await this.get(ctx, id);
    referral.reject({ by: ctx.userId, at: this.clock.now(), reason: input.reason, notes: input.notes });
    return this.commit(referral);
  }

  /**
   * Turns an accepted referral into a deal registration and submits it, so the
   * conflict checks and auto-approval that guard every other registration also
   * guard this path. The registration inherits the referral's customer and
   * product lines and is marked `vendor_referred`.
   */
  async convertToRegistration(
    ctx: TenantContext,
    id: Ulid,
    command: ConvertToRegistrationCommand,
  ): Promise<{ referral: Referral; registration: DealRegistration }> {
    const referral = await this.get(ctx, id);
    if (referral.status !== "accepted") {
      throw new ValidationError(`Referral ${referral.number} is ${referral.status}; only accepted referrals convert`);
    }
    const transactingPartnerId = command.transactingPartnerId ?? referral.partnerId;
    const registration = await this.registrationService.create(ctx, {
      partnerId: transactingPartnerId,
      endCustomer: {
        name: referral.company.name,
        domain: referral.company.domain,
        country: referral.company.country,
        region: referral.company.region,
      },
      productLines: command.productLines ?? referral.productLines,
      estimatedValue: command.estimatedValue,
      expectedCloseDate: command.expectedCloseDate,
      description: command.description,
      source: "vendor_referred",
      referralId: referral.id,
    });
    await this.registrationService.submit(ctx, registration.id);
    referral.convert({ by: ctx.userId, at: this.clock.now(), registrationId: registration.id });
    await this.commit(referral);
    return { referral, registration: await this.registrationService.get(ctx, registration.id) };
  }

  /** Conversion for deals the vendor runs directly; the partner still earns. */
  async convertToOpportunity(ctx: TenantContext, id: Ulid, opportunityRef: string): Promise<Referral> {
    const referral = await this.get(ctx, id);
    referral.convert({ by: ctx.userId, at: this.clock.now(), opportunityRef });
    return this.commit(referral);
  }

  async markWon(ctx: TenantContext, id: Ulid, value: Money): Promise<{ referral: Referral; commission: ReferralCommission }> {
    const referral = await this.get(ctx, id);
    const commission = referral.markWon({ by: ctx.userId, at: this.clock.now(), value });
    await this.commit(referral);
    return { referral, commission };
  }

  async markLost(ctx: TenantContext, id: Ulid, reason: string): Promise<Referral> {
    const referral = await this.get(ctx, id);
    referral.markLost({ by: ctx.userId, at: this.clock.now(), reason });
    return this.commit(referral);
  }

  async approveCommission(ctx: TenantContext, id: Ulid): Promise<Referral> {
    const referral = await this.get(ctx, id);
    referral.approveCommission(ctx.userId, this.clock.now());
    return this.commit(referral);
  }

  async payCommission(ctx: TenantContext, id: Ulid, paymentRef: string): Promise<Referral> {
    const referral = await this.get(ctx, id);
    referral.payCommission(ctx.userId, this.clock.now(), paymentRef);
    return this.commit(referral);
  }

  /**
   * Commission position per partner and currency. Accrued, approved and paid
   * are reported separately because they are three different liabilities to
   * finance, not three stages of one number.
   */
  async commissionLedger(ctx: TenantContext, partnerId?: Ulid): Promise<readonly CommissionLedgerEntry[]> {
    const all = (await this.referrals.all(ctx.tenantId)).filter(
      (r) => r.commission !== undefined && (!partnerId || r.partnerId === partnerId),
    );
    const groups = new Map<string, Referral[]>();
    for (const referral of all) {
      const key = `${referral.partnerId}|${referral.commission!.amount.currency}`;
      const bucket = groups.get(key) ?? [];
      bucket.push(referral);
      groups.set(key, bucket);
    }
    return [...groups.entries()]
      .map(([key, referrals]) => {
        const [partner, currency] = key.split("|") as [string, string];
        const sumBy = (status: string) =>
          sumMoney(
            referrals.filter((r) => r.commission!.status === status).map((r) => r.commission!.amount),
            currency,
          );
        return {
          partnerId: partner as Ulid,
          currency,
          accrued: sumBy("accrued"),
          approved: sumBy("approved"),
          paid: sumBy("paid"),
          referralCount: referrals.length,
        };
      })
      .sort((a, b) => b.accrued.amountMinor - a.accrued.amountMinor);
  }

  /** Referrals that lapsed on the decision SLA or on attribution. */
  async sweepExpired(ctx: TenantContext, at?: IsoDateTime): Promise<readonly Referral[]> {
    const now = at ?? this.clock.now();
    const due = await this.referrals.dueForExpiry(ctx.tenantId, now);
    const expired: Referral[] = [];
    for (const referral of due) {
      if (referral.expire(now)) {
        await this.referrals.save(referral);
        await this.publisher.publish(referral);
        expired.push(referral);
      }
    }
    return expired;
  }

  /** Zero-value helper so callers can render an empty ledger row. */
  static emptyLedgerEntry(partnerId: Ulid, currency: string): CommissionLedgerEntry {
    return {
      partnerId,
      currency,
      accrued: zeroMoney(currency),
      approved: zeroMoney(currency),
      paid: zeroMoney(currency),
      referralCount: 0,
    };
  }

  private async commit(referral: Referral): Promise<Referral> {
    await this.referrals.save(referral);
    await this.publisher.publish(referral);
    return referral;
  }
}

import {
  NotFoundError,
  normalizePage,
  type IsoDateTime,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  ConflictCase,
  detectConflicts,
  recommendOutcome,
  type ConflictEvidence,
  type ConflictFinding,
  type ConflictOutcome,
  type DirectClaim,
  type RegistrationClaim,
  type Recommendation,
} from "../domain/conflict.js";
import type { DealRegistration } from "../domain/deal-registration.js";
import { InvalidStateError, ValidationError } from "../domain/errors.js";
import { formatNumber } from "../domain/numbering.js";
import { addDays, type Interval } from "../domain/protection.js";
import type { Partner } from "../domain/partner.js";
import type {
  Clock,
  ConflictFilter,
  ConflictRepository,
  DirectClaimRepository,
  OutboxPort,
  PartnerRepository,
  RegistrationRepository,
  SequencePort,
  TierPolicyRepository,
} from "./ports.js";
import { Publisher } from "./unit-of-work.js";

export interface DetectionRequest {
  readonly partnerId: Ulid;
  readonly customerKey: string;
  readonly productLines: readonly string[];
  /** Protection the candidate would receive; defaults to the tier's grant. */
  readonly protectionDays: number;
  readonly excludeRegistrationId?: Ulid;
  readonly at?: IsoDateTime;
}

export interface ResolveConflictCommand {
  readonly outcome: ConflictOutcome;
  readonly rationale: string;
  readonly splitBps?: number;
  /** Protection to grant a winning claimant; defaults to their tier's grant. */
  readonly protectionDays?: number;
}

/**
 * Conflict detection and adjudication.
 *
 * Detection is read-only and is used in three places: the portal pre-check,
 * registration submission, and re-checks before approval. Adjudication is the
 * only place in this service that mutates registrations — resolving a case
 * grants, revokes or shortens protection, and those writes are published
 * together with the case's own events so downstream consumers never see half
 * a decision.
 */
export class ConflictService {
  private readonly publisher: Publisher;

  constructor(
    private readonly conflicts: ConflictRepository,
    private readonly registrations: RegistrationRepository,
    private readonly partners: PartnerRepository,
    private readonly directClaims: DirectClaimRepository,
    private readonly policies: TierPolicyRepository,
    private readonly sequences: SequencePort,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  /** Projects a registration into the flat claim shape the detector consumes. */
  static toClaim(registration: DealRegistration): RegistrationClaim {
    const protection = registration.protection;
    return {
      registrationId: registration.id,
      number: registration.number,
      partnerId: registration.partnerId,
      customerKey: registration.customerKey,
      productLines: registration.productLines,
      status: registration.status,
      stage: registration.stage,
      estimatedValue: registration.estimatedValue,
      protection: protection ? { startsAt: protection.startsAt, endsAt: protection.endsAt } : undefined,
      lastActivityAt: registration.lastActivityAt,
      quoteCount: registration.quotes.length,
      orderCount: registration.orders.length,
    };
  }

  async detect(ctx: TenantContext, request: DetectionRequest): Promise<ConflictFinding[]> {
    const at = request.at ?? this.clock.now();
    const existing = (await this.registrations.byCustomerKey(ctx.tenantId, request.customerKey))
      .filter((r) => r.id !== request.excludeRegistrationId)
      .map((r) => ConflictService.toClaim(r));
    const requestedWindow: Interval = { startsAt: at, endsAt: addDays(at, request.protectionDays) };
    return detectConflicts({
      customerKey: request.customerKey,
      partnerId: request.partnerId,
      productLines: request.productLines,
      requestedWindow,
      existing,
      directClaims: await this.directClaims.list(ctx.tenantId),
      at,
    });
  }

  /**
   * Opens a case for a finding, unless an open case already covers the same
   * pair of registrations — a partner re-submitting must not spam the queue.
   */
  async raiseCase(
    ctx: TenantContext,
    claimant: DealRegistration,
    finding: ConflictFinding,
  ): Promise<ConflictCase> {
    const existing = await this.conflicts.byRegistration(ctx.tenantId, claimant.id);
    const duplicate = existing.find(
      (c) => c.isOpen() && c.incumbentRegistrationId === finding.incumbentRegistrationId,
    );
    if (duplicate) return duplicate;

    const at = this.clock.now();
    const incumbent = finding.incumbentRegistrationId
      ? await this.registrations.byId(ctx.tenantId, finding.incumbentRegistrationId)
      : undefined;
    const recommendation: Recommendation = recommendOutcome(
      ConflictService.toClaim(claimant),
      incumbent ? ConflictService.toClaim(incumbent) : undefined,
      at,
    );
    const partner = await this.partners.byId(ctx.tenantId, claimant.partnerId);
    const policy = await this.policies.get(ctx.tenantId, partner?.tier ?? "registered");

    const conflict = ConflictCase.openCase(ctx.tenantId, {
      number: formatNumber("conflict", await this.sequences.next(ctx.tenantId, "conflict")),
      finding,
      claimantRegistrationId: claimant.id,
      claimantPartnerId: claimant.partnerId,
      recommendation,
      raisedAt: at,
      slaHours: policy.conflictSlaHours,
    });
    claimant.attachConflict(conflict.id);
    if (incumbent) {
      incumbent.attachConflict(conflict.id);
      await this.registrations.save(incumbent);
    }
    await this.conflicts.save(conflict);
    await this.registrations.save(claimant);
    await this.publisher.publish(conflict, claimant, incumbent);
    return conflict;
  }

  async get(ctx: TenantContext, id: Ulid): Promise<ConflictCase> {
    const conflict = await this.conflicts.byId(ctx.tenantId, id);
    if (!conflict) throw new NotFoundError("ConflictCase", id);
    return conflict;
  }

  async list(ctx: TenantContext, filter: ConflictFilter, page?: Partial<PageRequest>): Promise<Page<ConflictCase>> {
    return this.conflicts.list(ctx.tenantId, filter, normalizePage(page));
  }

  async forRegistration(ctx: TenantContext, registrationId: Ulid): Promise<readonly ConflictCase[]> {
    return this.conflicts.byRegistration(ctx.tenantId, registrationId);
  }

  /** True while any case touching the registration is still open. */
  async hasOpenCase(ctx: TenantContext, registrationId: Ulid): Promise<boolean> {
    const cases = await this.conflicts.byRegistration(ctx.tenantId, registrationId);
    return cases.some((c) => c.isOpen());
  }

  async addEvidence(
    ctx: TenantContext,
    id: Ulid,
    input: { source: ConflictEvidence["source"]; note: string },
  ): Promise<ConflictEvidence> {
    const conflict = await this.get(ctx, id);
    const entry = conflict.addEvidence({
      by: ctx.userId,
      at: this.clock.now(),
      source: input.source,
      note: input.note,
    });
    await this.conflicts.save(conflict);
    await this.publisher.publish(conflict);
    return entry;
  }

  async startReview(ctx: TenantContext, id: Ulid): Promise<ConflictCase> {
    const conflict = await this.get(ctx, id);
    conflict.startReview(ctx.userId);
    await this.conflicts.save(conflict);
    return conflict;
  }

  async escalate(ctx: TenantContext, id: Ulid, reason: string): Promise<ConflictCase> {
    const conflict = await this.get(ctx, id);
    conflict.escalate({ by: ctx.userId, at: this.clock.now(), reason });
    await this.conflicts.save(conflict);
    await this.publisher.publish(conflict);
    return conflict;
  }

  async withdraw(ctx: TenantContext, id: Ulid, reason: string): Promise<ConflictCase> {
    const conflict = await this.get(ctx, id);
    conflict.withdraw({ by: ctx.userId, at: this.clock.now(), reason });
    await this.conflicts.save(conflict);
    await this.publisher.publish(conflict);
    return conflict;
  }

  /**
   * Decides a case and applies the decision to both registrations:
   *
   * | outcome            | claimant                    | incumbent                       |
   * | ------------------ | --------------------------- | ------------------------------- |
   * | incumbent_upheld   | rejected (`conflict_lost`)  | untouched                       |
   * | claimant_awarded   | approved with fresh window  | protection cut to now           |
   * | co_sell / split    | approved with fresh window  | protection kept                 |
   * | both_rejected      | rejected (`conflict_lost`)  | protection cut to now           |
   *
   * Everything is written before a single event is published.
   */
  async resolve(ctx: TenantContext, id: Ulid, command: ResolveConflictCommand): Promise<ConflictCase> {
    const conflict = await this.get(ctx, id);
    const at = this.clock.now();
    const claimant = await this.registrations.byId(ctx.tenantId, conflict.claimantRegistrationId);
    if (!claimant) throw new NotFoundError("DealRegistration", conflict.claimantRegistrationId);
    const incumbent = conflict.incumbentRegistrationId
      ? await this.registrations.byId(ctx.tenantId, conflict.incumbentRegistrationId)
      : undefined;

    const resolution = conflict.resolve({
      by: ctx.userId,
      at,
      outcome: command.outcome,
      rationale: command.rationale,
      splitBps: command.splitBps,
    });

    switch (resolution.outcome) {
      case "incumbent_upheld":
        this.rejectClaimant(claimant, ctx, at, conflict.number);
        break;
      case "claimant_awarded":
        await this.awardClaimant(ctx, claimant, at, command.protectionDays, conflict.number);
        if (incumbent?.protection && incumbent.status === "approved") {
          incumbent.truncateProtection(at, `Conflict ${conflict.number} awarded to ${claimant.number}`, ctx.userId, at);
        }
        break;
      case "co_sell":
      case "split":
        await this.awardClaimant(ctx, claimant, at, command.protectionDays, conflict.number);
        break;
      case "both_rejected":
        this.rejectClaimant(claimant, ctx, at, conflict.number);
        if (incumbent?.protection && incumbent.status === "approved") {
          incumbent.truncateProtection(at, `Conflict ${conflict.number} rejected both claims`, ctx.userId, at);
        }
        break;
    }

    await this.conflicts.save(conflict);
    await this.registrations.save(claimant);
    if (incumbent) await this.registrations.save(incumbent);
    await this.publisher.publish(conflict, claimant, incumbent);
    return conflict;
  }

  async listDirectClaims(ctx: TenantContext): Promise<readonly DirectClaim[]> {
    return this.directClaims.list(ctx.tenantId);
  }

  async addDirectClaim(ctx: TenantContext, claim: DirectClaim): Promise<DirectClaim> {
    if (!claim.customerKey?.trim()) throw ValidationError.single("customerKey", "is required");
    if (!claim.reason?.trim()) throw ValidationError.single("reason", "a reason is required");
    const normalized: DirectClaim = {
      customerKey: claim.customerKey.trim(),
      reason: claim.reason.trim(),
      productLines: claim.productLines,
      ownerId: claim.ownerId,
    };
    await this.directClaims.add(ctx.tenantId, normalized);
    return normalized;
  }

  async removeDirectClaim(ctx: TenantContext, customerKey: string): Promise<void> {
    await this.directClaims.remove(ctx.tenantId, customerKey);
  }

  /** Open cases past their SLA, for the escalation queue. */
  async overdue(ctx: TenantContext, at?: IsoDateTime): Promise<readonly ConflictCase[]> {
    const now = at ?? this.clock.now();
    const page = await this.conflicts.list(
      ctx.tenantId,
      { overdueAt: now },
      normalizePage({ pageSize: 200 }),
    );
    return page.items;
  }

  private rejectClaimant(claimant: DealRegistration, ctx: TenantContext, at: IsoDateTime, caseNumber: string): void {
    if (claimant.status === "submitted" || claimant.status === "under_review") {
      claimant.reject({
        by: ctx.userId,
        at,
        reasonCode: "conflict_lost",
        notes: `Conflict ${caseNumber} decided against this registration`,
      });
    } else if (claimant.status === "approved" && claimant.protection) {
      claimant.truncateProtection(at, `Conflict ${caseNumber} decided against this registration`, ctx.userId, at);
    }
  }

  private async awardClaimant(
    ctx: TenantContext,
    claimant: DealRegistration,
    at: IsoDateTime,
    protectionDays: number | undefined,
    caseNumber: string,
  ): Promise<void> {
    if (claimant.status === "approved") return;
    if (claimant.status !== "submitted" && claimant.status !== "under_review") {
      throw new InvalidStateError(
        `Registration ${claimant.number} is ${claimant.status}; it cannot be awarded by conflict ${caseNumber}`,
      );
    }
    const partner: Partner | undefined = await this.partners.byId(ctx.tenantId, claimant.partnerId);
    const policy = await this.policies.get(ctx.tenantId, partner?.tier ?? "registered");
    claimant.approve({
      by: ctx.userId,
      at,
      protectionDays: protectionDays ?? policy.protectionDays,
      discountBps: policy.registeredDiscountBps,
      tier: partner?.tier ?? "registered",
      notes: `Awarded by conflict ${caseNumber}`,
    });
  }
}

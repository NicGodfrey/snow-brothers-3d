import type { IsoDateTime, TenantContext } from "@enterprise-suite/shared-kernel";
import type { DealRegistration } from "../domain/deal-registration.js";
import type { Clock, ConflictRepository, OutboxPort, RegistrationRepository } from "./ports.js";
import type { QuoteService } from "./quote-service.js";
import type { ReferralService } from "./referral-service.js";
import { Publisher } from "./unit-of-work.js";

export interface SweepSummary {
  readonly at: IsoDateTime;
  readonly protectionExpired: readonly string[];
  readonly protectionWarned: readonly string[];
  readonly referralsExpired: readonly string[];
  readonly quotesExpired: readonly string[];
  readonly conflictsOverdue: readonly string[];
}

/** How long before a window lapses the holder is told about it. */
const DEFAULT_NOTICE_DAYS = 7;

/**
 * Time-driven transitions.
 *
 * Nothing in this context expires by being read: a lapsed protection window
 * only becomes an `expired` registration when the sweep runs, and the sweep is
 * idempotent, so running it twice a minute or once a day produces the same
 * events exactly once. Deployments call it from a scheduler; the HTTP endpoint
 * exists so tests and demos can drive it explicitly.
 */
export class ExpiryService {
  private readonly publisher: Publisher;

  constructor(
    private readonly registrations: RegistrationRepository,
    private readonly conflicts: ConflictRepository,
    private readonly referralService: ReferralService,
    private readonly quoteService: QuoteService,
    outbox: OutboxPort,
    private readonly clock: Clock,
  ) {
    this.publisher = new Publisher(outbox);
  }

  async sweep(ctx: TenantContext, options: { at?: IsoDateTime; noticeDays?: number } = {}): Promise<SweepSummary> {
    const at = options.at ?? this.clock.now();
    const noticeDays = options.noticeDays ?? DEFAULT_NOTICE_DAYS;

    const protectionExpired: string[] = [];
    for (const registration of await this.registrations.lapsedAt(ctx.tenantId, at)) {
      if (registration.expire(at)) {
        await this.persist(registration);
        protectionExpired.push(registration.number);
      }
    }

    const protectionWarned: string[] = [];
    for (const registration of await this.registrations.protectedAt(ctx.tenantId, at)) {
      if (registration.warnExpiring(at, noticeDays)) {
        await this.persist(registration);
        protectionWarned.push(registration.number);
      }
    }

    const referralsExpired = (await this.referralService.sweepExpired(ctx, at)).map((r) => r.number);
    const quotesExpired = (await this.quoteService.sweepExpired(ctx, at)).map((q) => q.number);

    const overdue = await this.conflicts.list(ctx.tenantId, { overdueAt: at }, { page: 1, pageSize: 200 });

    return {
      at,
      protectionExpired,
      protectionWarned,
      referralsExpired,
      quotesExpired,
      conflictsOverdue: overdue.items.map((c) => c.number),
    };
  }

  private async persist(registration: DealRegistration): Promise<void> {
    await this.registrations.save(registration);
    await this.publisher.publish(registration);
  }
}

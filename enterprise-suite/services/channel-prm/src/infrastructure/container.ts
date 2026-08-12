import { AnalyticsService } from "../application/analytics-service.js";
import { ConflictService } from "../application/conflict-service.js";
import { ExpiryService } from "../application/expiry-service.js";
import { OrderService } from "../application/order-service.js";
import { PartnerService } from "../application/partner-service.js";
import type { Clock } from "../application/ports.js";
import { QuoteService } from "../application/quote-service.js";
import { ReferralService } from "../application/referral-service.js";
import { RegistrationService } from "../application/registration-service.js";
import {
  InMemoryChannelOrderRepository,
  InMemoryChannelQuoteRepository,
  InMemoryConflictRepository,
  InMemoryDirectClaimRepository,
  InMemoryOutbox,
  InMemoryPartnerRepository,
  InMemoryReferralRepository,
  InMemoryRegistrationRepository,
  InMemorySequences,
  InMemoryTierPolicyRepository,
  SystemClock,
} from "./memory/stores.js";

/**
 * Composition root.
 *
 * The wiring encodes the one-way dependency the services are designed around:
 * registration → conflict → (repositories), and referral/quote/order →
 * registration. Nothing calls back up, so there is no cycle to break.
 */
export interface ChannelContainer {
  readonly repos: {
    readonly partners: InMemoryPartnerRepository;
    readonly registrations: InMemoryRegistrationRepository;
    readonly referrals: InMemoryReferralRepository;
    readonly quotes: InMemoryChannelQuoteRepository;
    readonly orders: InMemoryChannelOrderRepository;
    readonly conflicts: InMemoryConflictRepository;
    readonly directClaims: InMemoryDirectClaimRepository;
    readonly tierPolicies: InMemoryTierPolicyRepository;
  };
  readonly sequences: InMemorySequences;
  readonly outbox: InMemoryOutbox;
  readonly clock: Clock;
  readonly services: {
    readonly partner: PartnerService;
    readonly conflict: ConflictService;
    readonly registration: RegistrationService;
    readonly referral: ReferralService;
    readonly quote: QuoteService;
    readonly order: OrderService;
    readonly analytics: AnalyticsService;
    readonly expiry: ExpiryService;
  };
}

export function createContainer(options: { readonly clock?: Clock } = {}): ChannelContainer {
  const clock = options.clock ?? new SystemClock();
  const outbox = new InMemoryOutbox();
  const sequences = new InMemorySequences();

  const partners = new InMemoryPartnerRepository();
  const registrations = new InMemoryRegistrationRepository();
  const referrals = new InMemoryReferralRepository();
  const quotes = new InMemoryChannelQuoteRepository();
  const orders = new InMemoryChannelOrderRepository();
  const conflicts = new InMemoryConflictRepository();
  const directClaims = new InMemoryDirectClaimRepository();
  const tierPolicies = new InMemoryTierPolicyRepository();

  const partner = new PartnerService(partners, tierPolicies, outbox, clock);
  const conflict = new ConflictService(
    conflicts,
    registrations,
    partners,
    directClaims,
    tierPolicies,
    sequences,
    outbox,
    clock,
  );
  const registration = new RegistrationService(registrations, partner, conflict, sequences, outbox, clock);
  const referral = new ReferralService(referrals, partner, registration, sequences, outbox, clock);
  const quote = new QuoteService(quotes, registrations, partner, registration, sequences, outbox, clock);
  const order = new OrderService(orders, quotes, registrations, partner, sequences, outbox, clock);
  const analytics = new AnalyticsService(registrations, referrals, orders, partners, conflicts, clock);
  const expiry = new ExpiryService(registrations, conflicts, referral, quote, outbox, clock);

  return {
    repos: { partners, registrations, referrals, quotes, orders, conflicts, directClaims, tierPolicies },
    sequences,
    outbox,
    clock,
    services: { partner, conflict, registration, referral, quote, order, analytics, expiry },
  };
}

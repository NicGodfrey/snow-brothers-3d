import type { IsoDateTime, Page } from "@enterprise-suite/shared-kernel";
import type { ChannelOrder } from "../domain/channel-order.js";
import type { ChannelQuote } from "../domain/channel-quote.js";
import type { ConflictCase } from "../domain/conflict.js";
import type { DealRegistration } from "../domain/deal-registration.js";
import type { Partner, TierPolicy } from "../domain/partner.js";
import type { Referral } from "../domain/referral.js";
import { forecastCategoryFor } from "../domain/stages.js";

/**
 * Read models for the HTTP layer.
 *
 * `toJSON()` gives the stored state; a client also needs what the domain
 * derives — days of protection left, effective discount, whether the deal is
 * still exclusive right now. Those are computed here, against an explicit
 * instant, rather than being persisted and going stale.
 */

export function partnerView(partner: Partner, policy?: TierPolicy) {
  return {
    ...partner.toJSON(),
    canTransact: partner.canTransact,
    policy,
  };
}

export function registrationView(registration: DealRegistration, at: IsoDateTime) {
  const protection = registration.protectionSnapshot(at);
  return {
    ...registration.toJSON(),
    protectionStatus: protection
      ? {
          ...protection,
          protectedNow: registration.isProtectedAt(at),
        }
      : undefined,
    forecastCategory: forecastCategoryFor(registration.stage, registration.probability),
    cycleDays: registration.cycleDays(),
    quoteCount: registration.quotes.length,
    orderCount: registration.orders.length,
    openConflicts: registration.conflictCaseIds.length,
  };
}

export function referralView(referral: Referral, at: IsoDateTime) {
  return {
    ...referral.toJSON(),
    attributionStatus: referral.attributionSnapshot(at),
    attributedNow: referral.isAttributedAt(at),
  };
}

export function quoteView(quote: ChannelQuote, at: IsoDateTime) {
  return {
    ...quote.toJSON(),
    totals: {
      list: quote.listTotal(),
      requested: quote.requestedTotal(),
      approved: quote.approvedTotal(),
      requestedDiscountBps: quote.requestedDiscountBps(),
      effectiveDiscountBps: quote.effectiveDiscountBps(),
      concessionAgainstRequest: quote.concessionAgainstRequest(),
    },
    expired: quote.isExpiredAt(at),
  };
}

export function orderView(order: ChannelOrder) {
  return {
    ...order.toJSON(),
    bookedValue: order.bookedValue(),
  };
}

export function conflictView(conflict: ConflictCase, at: IsoDateTime) {
  return {
    ...conflict.toJSON(),
    overdue: conflict.isOverdueAt(at),
    open: conflict.isOpen(),
  };
}

export function pageView<TIn, TOut>(page: Page<TIn>, map: (item: TIn) => TOut) {
  return {
    items: page.items.map(map),
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    nextCursor: page.nextCursor,
  };
}

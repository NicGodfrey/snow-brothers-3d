import { addMoney, compareMoney, mulMoney, type Money, zeroMoney } from "../../kernel/index.js";
import type { Account } from "./account.js";

export type CreditDecision = "approved" | "review_required" | "declined";

export interface CreditCheckResult {
  readonly decision: CreditDecision;
  readonly reasons: readonly string[];
  readonly exposureMinor: number;
  readonly limitMinor: number | null;
}

/**
 * Simple credit rules:
 * - account on credit hold           -> declined
 * - account closed                   -> declined
 * - no credit limit configured       -> approved
 * - exposure + order total <= limit  -> approved
 * - <= limit * REVIEW_TOLERANCE      -> review_required (manager may override)
 * - otherwise                        -> declined
 *
 * Exposure = sum of open (confirmed/allocated/shipped, not yet closed/cancelled)
 * order totals for the account; the caller computes it so this policy stays pure.
 */
export const REVIEW_TOLERANCE = 1.1;

export function checkCredit(account: Account, openExposure: Money, orderTotal: Money): CreditCheckResult {
  const reasons: string[] = [];
  const limit = account.creditLimit;
  const exposureMinor = openExposure.amountMinor as unknown as number;
  const limitMinor = limit ? (limit.amountMinor as unknown as number) : null;

  if (account.status === "closed") {
    return { decision: "declined", reasons: ["Account is closed"], exposureMinor, limitMinor };
  }
  if (account.creditHold) {
    return { decision: "declined", reasons: ["Account is on credit hold"], exposureMinor, limitMinor };
  }
  if (limit === null) {
    return { decision: "approved", reasons: ["No credit limit configured"], exposureMinor, limitMinor };
  }

  const projected = addMoney(openExposure, orderTotal);
  if (compareMoney(projected, limit) <= 0) {
    return { decision: "approved", reasons: ["Within credit limit"], exposureMinor, limitMinor };
  }

  const reviewCeiling = mulMoney(limit, REVIEW_TOLERANCE);
  if (compareMoney(projected, reviewCeiling) <= 0) {
    reasons.push(
      `Projected exposure ${projected.amountMinor} exceeds limit ${limit.amountMinor} but is within ${Math.round((REVIEW_TOLERANCE - 1) * 100)}% tolerance`,
    );
    return { decision: "review_required", reasons, exposureMinor, limitMinor };
  }

  reasons.push(`Projected exposure ${projected.amountMinor} exceeds limit ${limit.amountMinor} beyond tolerance`);
  return { decision: "declined", reasons, exposureMinor, limitMinor };
}

export function noExposure(currencyCode: string): Money {
  return zeroMoney(currencyCode);
}

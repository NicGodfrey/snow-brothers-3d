import { ConflictError, percentOf, subMoney, type Money } from "../../kernel/index.js";

/** Line discounts above this need a sales_manager (or admin) approval on the quote. */
export const MANAGER_APPROVAL_DISCOUNT_THRESHOLD = 15;
/** Hard cap: no line discount may exceed this. */
export const MAX_LINE_DISCOUNT_PERCENT = 60;

export interface VolumeDiscountRule {
  readonly minQty: number;
  readonly percent: number;
}

/** Default volume ladder used when a quote line has no explicit discount. */
export const DEFAULT_VOLUME_RULES: readonly VolumeDiscountRule[] = [
  { minQty: 10, percent: 2.5 },
  { minQty: 50, percent: 5 },
  { minQty: 100, percent: 8 },
];

export function assertValidDiscountPercent(percent: number): void {
  if (Number.isNaN(percent) || percent < 0) {
    throw new ConflictError(`Discount percent must be >= 0 (got ${percent})`);
  }
  if (percent > MAX_LINE_DISCOUNT_PERCENT) {
    throw new ConflictError(
      `Discount percent ${percent} exceeds the maximum of ${MAX_LINE_DISCOUNT_PERCENT}%`,
    );
  }
}

export function volumeDiscountPercent(
  qty: number,
  rules: readonly VolumeDiscountRule[] = DEFAULT_VOLUME_RULES,
): number {
  let best = 0;
  for (const rule of [...rules].sort((a, b) => a.minQty - b.minQty)) {
    if (qty >= rule.minQty) best = rule.percent;
  }
  return best;
}

export function applyDiscount(gross: Money, percent: number): { net: Money; discount: Money } {
  assertValidDiscountPercent(percent);
  const discount = percentOf(gross, percent);
  return { net: subMoney(gross, discount), discount };
}

export function requiresManagerApproval(maxLineDiscountPercent: number): boolean {
  return maxLineDiscountPercent > MANAGER_APPROVAL_DISCOUNT_THRESHOLD;
}

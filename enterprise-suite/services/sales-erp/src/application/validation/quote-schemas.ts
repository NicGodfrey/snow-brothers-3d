import {
  vArray,
  vEnum,
  vInt,
  vIsoDate,
  vNumber,
  vObject,
  vOptional,
  vString,
  type Infer,
} from "./validator.js";
import { TAX_CATEGORIES } from "./pricing-schemas.js";

/**
 * unitPriceMinor is optional on quote lines: when omitted, the price is
 * resolved from the price list (tier pricing); when present it is an override.
 */
export const quoteLineInputSchema = vObject({
  sku: vString({ min: 1, max: 60 }),
  description: vOptional(vString({ max: 300 })),
  qty: vInt({ min: 1 }),
  unitPriceMinor: vOptional(vInt({ min: 0 })),
  discountPercent: vOptional(vNumber({ min: 0, max: 100 })),
  taxCategory: vOptional(vEnum(TAX_CATEGORIES)),
});

export type QuoteLineCommand = Infer<typeof quoteLineInputSchema>;

export const createQuoteSchema = vObject({
  accountId: vString({ min: 1 }),
  opportunityId: vOptional(vString({ min: 1 })),
  priceListId: vOptional(vString({ min: 1 })),
  taxRegion: vString({ min: 2, max: 2, pattern: /^[A-Za-z]{2}$/ }),
  validUntil: vIsoDate(),
  notes: vOptional(vString({ max: 2000 })),
  lines: vOptional(vArray(quoteLineInputSchema, { max: 200 })),
});

export type CreateQuoteCommand = Infer<typeof createQuoteSchema>;

export const updateQuoteLineSchema = vObject({
  qty: vOptional(vInt({ min: 1 })),
  unitPriceMinor: vOptional(vInt({ min: 0 })),
  discountPercent: vOptional(vNumber({ min: 0, max: 100 })),
  description: vOptional(vString({ max: 300 })),
});

export const rejectQuoteSchema = vObject({
  reason: vString({ min: 2, max: 500 }),
});

export const reviseQuoteSchema = vObject({
  validUntil: vIsoDate(),
});

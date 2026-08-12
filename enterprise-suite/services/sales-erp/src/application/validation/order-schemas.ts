import {
  vArray,
  vBoolean,
  vEnum,
  vInt,
  vNumber,
  vObject,
  vOptional,
  vString,
  type Infer,
} from "./validator.js";
import { addressSchema } from "./account-schemas.js";
import { TAX_CATEGORIES } from "./pricing-schemas.js";

export const orderLineInputSchema = vObject({
  sku: vString({ min: 1, max: 60 }),
  description: vOptional(vString({ max: 300 })),
  qty: vInt({ min: 1 }),
  unitPriceMinor: vOptional(vInt({ min: 0 })),
  discountPercent: vOptional(vNumber({ min: 0, max: 100 })),
  taxCategory: vOptional(vEnum(TAX_CATEGORIES)),
});

export type OrderLineCommand = Infer<typeof orderLineInputSchema>;

export const createDraftOrderSchema = vObject({
  accountId: vString({ min: 1 }),
  taxRegion: vString({ min: 2, max: 2, pattern: /^[A-Za-z]{2}$/ }),
  priceListId: vOptional(vString({ min: 1 })),
  shippingAddress: vOptional(addressSchema),
  notes: vOptional(vString({ max: 2000 })),
  lines: vOptional(vArray(orderLineInputSchema, { max: 200 })),
});

export type CreateDraftOrderCommand = Infer<typeof createDraftOrderSchema>;

export const createOrderFromQuoteSchema = vObject({
  quoteId: vString({ min: 1 }),
  shippingAddress: vOptional(addressSchema),
});

export const confirmOrderSchema = vObject({
  /** sales_manager/admin may push through a review_required credit decision. */
  overrideCreditReview: vOptional(vBoolean()),
});

export const quantityByLineSchema = vObject({
  lineId: vString({ min: 1 }),
  qty: vInt({ min: 1 }),
});

export const allocateOrderSchema = vObject({
  allocations: vArray(quantityByLineSchema, { min: 1, max: 200 }),
});

export const shipOrderSchema = vObject({
  shipments: vArray(quantityByLineSchema, { min: 1, max: 200 }),
});

export const cancelOrderSchema = vObject({
  reason: vString({ min: 2, max: 500 }),
});

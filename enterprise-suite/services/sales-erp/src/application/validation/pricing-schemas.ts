import {
  vArray,
  vBoolean,
  vCurrency,
  vEnum,
  vInt,
  vIsoDate,
  vObject,
  vOptional,
  vString,
  type Infer,
} from "./validator.js";

export const TAX_CATEGORIES = ["standard", "reduced", "zero", "exempt"] as const;

export const createPriceListSchema = vObject({
  name: vString({ min: 1, max: 200 }),
  currency: vCurrency(),
  validFrom: vOptional(vIsoDate()),
  validUntil: vOptional(vIsoDate()),
  isDefault: vOptional(vBoolean()),
});

export type CreatePriceListCommand = Infer<typeof createPriceListSchema>;

export const priceTierSchema = vObject({
  minQty: vInt({ min: 1 }),
  unitPriceMinor: vInt({ min: 0 }),
});

export const upsertPriceItemSchema = vObject({
  sku: vString({ min: 1, max: 60 }),
  description: vString({ min: 1, max: 300 }),
  taxCategory: vOptional(vEnum(TAX_CATEGORIES)),
  tiers: vArray(priceTierSchema, { min: 1, max: 20 }),
});

export type UpsertPriceItemCommand = Infer<typeof upsertPriceItemSchema>;

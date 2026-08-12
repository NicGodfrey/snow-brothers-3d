import { vArray, vEnum, vInt, vObject, vOptional, vString, type Infer } from "./validator.js";

export const RETURN_REASONS = [
  "damaged",
  "wrong_item",
  "not_as_described",
  "no_longer_needed",
  "other",
] as const;

export const returnLineSchema = vObject({
  orderLineId: vString({ min: 1 }),
  qty: vInt({ min: 1 }),
  reason: vEnum(RETURN_REASONS),
});

export const requestReturnSchema = vObject({
  orderId: vString({ min: 1 }),
  lines: vArray(returnLineSchema, { min: 1, max: 100 }),
  notes: vOptional(vString({ max: 2000 })),
});

export type RequestReturnCommand = Infer<typeof requestReturnSchema>;

export const rejectReturnSchema = vObject({
  reason: vString({ min: 2, max: 500 }),
});

import {
  vCurrency,
  vEnum,
  vInt,
  vIsoDate,
  vObject,
  vOptional,
  vString,
  type Infer,
} from "./validator.js";

export const OPEN_STAGE_VALUES = ["prospecting", "qualification", "proposal", "negotiation"] as const;

export const createOpportunitySchema = vObject({
  accountId: vString({ min: 1 }),
  name: vString({ min: 1, max: 200 }),
  amountMinor: vInt({ min: 0 }),
  currency: vCurrency(),
  expectedCloseDate: vOptional(vIsoDate()),
  source: vOptional(vString({ max: 100 })),
});

export type CreateOpportunityCommand = Infer<typeof createOpportunitySchema>;

export const moveStageSchema = vObject({
  stage: vEnum(OPEN_STAGE_VALUES),
});

export const reviseAmountSchema = vObject({
  amountMinor: vInt({ min: 0 }),
});

export const loseOpportunitySchema = vObject({
  reason: vString({ min: 2, max: 500 }),
});

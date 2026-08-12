import {
  vBoolean,
  vCurrency,
  vEmail,
  vEnum,
  vInt,
  vNullable,
  vObject,
  vOptional,
  vString,
  type Infer,
} from "./validator.js";

export const addressSchema = vObject({
  line1: vString({ min: 1, max: 200 }),
  line2: vOptional(vString({ max: 200 })),
  city: vString({ min: 1, max: 100 }),
  region: vOptional(vString({ max: 100 })),
  postalCode: vString({ min: 1, max: 20 }),
  countryCode: vString({ min: 2, max: 2, pattern: /^[A-Za-z]{2}$/ }),
});

export const ACCOUNT_TYPES = ["prospect", "customer", "partner"] as const;
export const PAYMENT_TERMS = ["DUE_ON_RECEIPT", "NET15", "NET30", "NET45", "NET60"] as const;

export const createAccountSchema = vObject({
  name: vString({ min: 1, max: 200 }),
  accountType: vEnum(ACCOUNT_TYPES),
  currency: vCurrency(),
  paymentTerms: vOptional(vEnum(PAYMENT_TERMS)),
  industry: vOptional(vString({ max: 100 })),
  website: vOptional(vString({ max: 200 })),
  creditLimitMinor: vOptional(vNullable(vInt({ min: 0 }))),
  billingAddress: vOptional(addressSchema),
  shippingAddress: vOptional(addressSchema),
  ownerId: vOptional(vString({ min: 1, max: 100 })),
});

export type CreateAccountCommand = Infer<typeof createAccountSchema>;

export const updateAccountSchema = vObject({
  name: vOptional(vString({ min: 1, max: 200 })),
  industry: vOptional(vString({ max: 100 })),
  website: vOptional(vString({ max: 200 })),
  paymentTerms: vOptional(vEnum(PAYMENT_TERMS)),
  billingAddress: vOptional(addressSchema),
  shippingAddress: vOptional(addressSchema),
  ownerId: vOptional(vString({ min: 1, max: 100 })),
});

export type UpdateAccountCommand = Infer<typeof updateAccountSchema>;

export const CONTACT_ROLES = ["decision_maker", "influencer", "billing", "technical", "other"] as const;

export const addContactSchema = vObject({
  firstName: vString({ min: 1, max: 100 }),
  lastName: vString({ min: 1, max: 100 }),
  email: vEmail(),
  phone: vOptional(vString({ max: 40 })),
  role: vOptional(vEnum(CONTACT_ROLES)),
  isPrimary: vOptional(vBoolean()),
});

export type AddContactCommand = Infer<typeof addContactSchema>;

export const creditHoldSchema = vObject({
  reason: vString({ min: 3, max: 500 }),
});

export const creditLimitSchema = vObject({
  creditLimitMinor: vNullable(vInt({ min: 0 })),
});

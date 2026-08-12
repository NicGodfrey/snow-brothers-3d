import { envelope, type EventEnvelope, type TenantId, type Ulid } from "../../kernel/index.js";

export const ACCOUNT_AGGREGATE = "Account";

export const AccountEventTypes = {
  AccountCreated: "sales.account.created",
  AccountUpdated: "sales.account.updated",
  AccountConvertedToCustomer: "sales.account.converted-to-customer",
  AccountCreditHoldPlaced: "sales.account.credit-hold-placed",
  AccountCreditHoldReleased: "sales.account.credit-hold-released",
  AccountCreditLimitChanged: "sales.account.credit-limit-changed",
  AccountClosed: "sales.account.closed",
  ContactAdded: "sales.account.contact-added",
} as const;

export interface AccountCreatedPayload {
  readonly accountNumber: string;
  readonly name: string;
  readonly accountType: string;
}

export interface AccountConvertedPayload {
  readonly accountNumber: string;
  readonly previousType: string;
}

export interface CreditHoldPayload {
  readonly accountNumber: string;
  readonly reason: string;
}

export interface CreditLimitChangedPayload {
  readonly accountNumber: string;
  readonly previousLimitMinor: number | null;
  readonly newLimitMinor: number | null;
  readonly currency: string;
}

export interface ContactAddedPayload {
  readonly contactId: string;
  readonly contactName: string;
}

export function accountEvent<TPayload>(
  eventType: string,
  aggregateId: Ulid,
  tenantId: TenantId,
  payload: TPayload,
): EventEnvelope<TPayload> {
  return envelope({ eventType, aggregateType: ACCOUNT_AGGREGATE, aggregateId, tenantId, payload });
}

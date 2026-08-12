import { newId, type Ulid } from "@enterprise-suite/shared-kernel";

export type AccountId = Ulid;
export type JournalId = Ulid;
export type PeriodId = Ulid;
export type PeriodCloseRunId = Ulid;
export type ArInvoiceId = Ulid;
export type ArPaymentId = Ulid;
export type ApBillId = Ulid;
export type ApPaymentId = Ulid;
export type CostCenterId = Ulid;
export type AllocationRuleId = Ulid;
export type TaxCodeId = Ulid;
export type FxRateId = Ulid;

export const newAccountId = (): AccountId => newId("acct");
export const newJournalId = (): JournalId => newId("jrnl");
export const newPeriodId = (): PeriodId => newId("prd");
export const newPeriodCloseRunId = (): PeriodCloseRunId => newId("pcr");
export const newArInvoiceId = (): ArInvoiceId => newId("arin");
export const newArPaymentId = (): ArPaymentId => newId("arpy");
export const newApBillId = (): ApBillId => newId("apbl");
export const newApPaymentId = (): ApPaymentId => newId("appy");
export const newCostCenterId = (): CostCenterId => newId("cc");
export const newAllocationRuleId = (): AllocationRuleId => newId("alloc");
export const newTaxCodeId = (): TaxCodeId => newId("tax");
export const newFxRateId = (): FxRateId => newId("fx");

/** An ISO calendar date, e.g. "2026-03-31". Finance documents are dated by day, not instant. */
export type IsoDate = string;

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isIsoDate(value: string): value is IsoDate {
  return ISO_DATE_RE.test(value);
}

export function assertIsoDate(value: string, field: string): IsoDate {
  if (!isIsoDate(value)) {
    throw new Error(`${field} must be an ISO date (yyyy-mm-dd), got "${value}"`);
  }
  return value;
}

/** Basis points helper: 10000 bps == 100%. */
export const BPS_SCALE = 10_000;

export function applyBps(amountMinor: number, rateBps: number): number {
  return Math.round((amountMinor * rateBps) / BPS_SCALE);
}

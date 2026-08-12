import { type Ulid } from "@enterprise-suite/shared-kernel";
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
export declare const newAccountId: () => AccountId;
export declare const newJournalId: () => JournalId;
export declare const newPeriodId: () => PeriodId;
export declare const newPeriodCloseRunId: () => PeriodCloseRunId;
export declare const newArInvoiceId: () => ArInvoiceId;
export declare const newArPaymentId: () => ArPaymentId;
export declare const newApBillId: () => ApBillId;
export declare const newApPaymentId: () => ApPaymentId;
export declare const newCostCenterId: () => CostCenterId;
export declare const newAllocationRuleId: () => AllocationRuleId;
export declare const newTaxCodeId: () => TaxCodeId;
export declare const newFxRateId: () => FxRateId;
/** An ISO calendar date, e.g. "2026-03-31". Finance documents are dated by day, not instant. */
export type IsoDate = string;
export declare function isIsoDate(value: string): value is IsoDate;
export declare function assertIsoDate(value: string, field: string): IsoDate;
/** Basis points helper: 10000 bps == 100%. */
export declare const BPS_SCALE = 10000;
export declare function applyBps(amountMinor: number, rateBps: number): number;
//# sourceMappingURL=ids.d.ts.map
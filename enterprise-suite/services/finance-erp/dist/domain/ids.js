import { newId } from "@enterprise-suite/shared-kernel";
export const newAccountId = () => newId("acct");
export const newJournalId = () => newId("jrnl");
export const newPeriodId = () => newId("prd");
export const newPeriodCloseRunId = () => newId("pcr");
export const newArInvoiceId = () => newId("arin");
export const newArPaymentId = () => newId("arpy");
export const newApBillId = () => newId("apbl");
export const newApPaymentId = () => newId("appy");
export const newCostCenterId = () => newId("cc");
export const newAllocationRuleId = () => newId("alloc");
export const newTaxCodeId = () => newId("tax");
export const newFxRateId = () => newId("fx");
const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function isIsoDate(value) {
    return ISO_DATE_RE.test(value);
}
export function assertIsoDate(value, field) {
    if (!isIsoDate(value)) {
        throw new Error(`${field} must be an ISO date (yyyy-mm-dd), got "${value}"`);
    }
    return value;
}
/** Basis points helper: 10000 bps == 100%. */
export const BPS_SCALE = 10_000;
export function applyBps(amountMinor, rateBps) {
    return Math.round((amountMinor * rateBps) / BPS_SCALE);
}
//# sourceMappingURL=ids.js.map
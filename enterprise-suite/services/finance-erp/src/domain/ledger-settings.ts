import type { CurrencyCode, TenantId } from "@enterprise-suite/shared-kernel";
import type { AccountId } from "./ids.js";

/**
 * Per-tenant control-account mapping used by the AR/AP services when they
 * translate subledger documents into GL journals. Configured once at tenant
 * bootstrap (see LedgerSettingsService).
 */
export interface LedgerSettings {
  readonly tenantId: TenantId;
  readonly baseCurrency: CurrencyCode;
  /** DR on invoice issue, CR on customer payment. */
  readonly arControlAccountId: AccountId;
  /** CR on bill approval, DR on supplier payment. */
  readonly apControlAccountId: AccountId;
  /** DR on customer payment, CR on supplier payment. */
  readonly cashAccountId: AccountId;
  /** CR with sales tax on invoice issue. */
  readonly salesTaxPayableAccountId: AccountId;
  /** DR with recoverable purchase tax on bill approval. */
  readonly purchaseTaxReceivableAccountId: AccountId;
}

import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { Account } from "../domain/account.js";
import type { AllocationRule } from "../domain/allocation.js";
import type { ApBill } from "../domain/ap-bill.js";
import type { ApPayment } from "../domain/ap-payment.js";
import type { ArInvoice } from "../domain/ar-invoice.js";
import type { ArPayment } from "../domain/ar-payment.js";
import type { CostCenter } from "../domain/cost-center.js";
import type { FxRate } from "../domain/fx-rate.js";
import type {
  AccountId,
  AllocationRuleId,
  ApBillId,
  ApPaymentId,
  ArInvoiceId,
  ArPaymentId,
  CostCenterId,
  IsoDate,
  JournalId,
  PeriodCloseRunId,
  TaxCodeId,
} from "../domain/ids.js";
import type { Journal, JournalStatus } from "../domain/journal.js";
import type { PostingPeriod } from "../domain/period.js";
import type { PeriodCloseRun } from "../domain/period-close.js";
import type { LedgerSettings } from "../domain/ledger-settings.js";
import type { TaxCode } from "../domain/tax-code.js";

/**
 * Repository ports. Implementations must scope every operation by tenant.
 * The in-memory versions back tests and local dev; the interfaces are kept
 * async and narrow so a Postgres adapter can drop in behind them.
 */

export interface AccountRepository {
  save(account: Account): Promise<void>;
  findById(tenantId: TenantId, id: AccountId): Promise<Account | undefined>;
  findByCode(tenantId: TenantId, code: string): Promise<Account | undefined>;
  list(tenantId: TenantId): Promise<Account[]>;
}

export interface JournalRepository {
  save(journal: Journal): Promise<void>;
  findById(tenantId: TenantId, id: JournalId): Promise<Journal | undefined>;
  list(tenantId: TenantId, filter?: {
    status?: JournalStatus;
    periodCode?: string;
    source?: string;
  }): Promise<Journal[]>;
  /** All journals with the given status dated inside [startDate, endDate]. */
  listByDateRange(
    tenantId: TenantId,
    startDate: IsoDate,
    endDate: IsoDate,
    status?: JournalStatus,
  ): Promise<Journal[]>;
  nextJournalNo(tenantId: TenantId): Promise<string>;
}

export interface PeriodRepository {
  save(period: PostingPeriod): Promise<void>;
  findByCode(tenantId: TenantId, code: string): Promise<PostingPeriod | undefined>;
  /** The open/closing period whose date range contains the given date. */
  findByDate(tenantId: TenantId, date: IsoDate): Promise<PostingPeriod | undefined>;
  list(tenantId: TenantId, fiscalYear?: number): Promise<PostingPeriod[]>;
}

export interface PeriodCloseRunRepository {
  save(run: PeriodCloseRun): Promise<void>;
  findById(tenantId: TenantId, id: PeriodCloseRunId): Promise<PeriodCloseRun | undefined>;
  findActiveForPeriod(tenantId: TenantId, periodCode: string): Promise<PeriodCloseRun | undefined>;
  list(tenantId: TenantId, periodCode?: string): Promise<PeriodCloseRun[]>;
}

export interface ArInvoiceRepository {
  save(invoice: ArInvoice): Promise<void>;
  findById(tenantId: TenantId, id: ArInvoiceId): Promise<ArInvoice | undefined>;
  list(tenantId: TenantId, filter?: { customerId?: string; status?: string }): Promise<ArInvoice[]>;
  nextInvoiceNo(tenantId: TenantId): Promise<string>;
}

export interface ArPaymentRepository {
  save(payment: ArPayment): Promise<void>;
  findById(tenantId: TenantId, id: ArPaymentId): Promise<ArPayment | undefined>;
  list(tenantId: TenantId, filter?: { customerId?: string }): Promise<ArPayment[]>;
  nextPaymentNo(tenantId: TenantId): Promise<string>;
}

export interface ApBillRepository {
  save(bill: ApBill): Promise<void>;
  findById(tenantId: TenantId, id: ApBillId): Promise<ApBill | undefined>;
  list(tenantId: TenantId, filter?: { supplierId?: string; status?: string }): Promise<ApBill[]>;
  nextBillNo(tenantId: TenantId): Promise<string>;
}

export interface ApPaymentRepository {
  save(payment: ApPayment): Promise<void>;
  findById(tenantId: TenantId, id: ApPaymentId): Promise<ApPayment | undefined>;
  list(tenantId: TenantId, filter?: { supplierId?: string }): Promise<ApPayment[]>;
  nextPaymentNo(tenantId: TenantId): Promise<string>;
}

export interface CostCenterRepository {
  save(costCenter: CostCenter): Promise<void>;
  findById(tenantId: TenantId, id: CostCenterId): Promise<CostCenter | undefined>;
  findByCode(tenantId: TenantId, code: string): Promise<CostCenter | undefined>;
  list(tenantId: TenantId): Promise<CostCenter[]>;
}

export interface AllocationRuleRepository {
  save(rule: AllocationRule): Promise<void>;
  findById(tenantId: TenantId, id: AllocationRuleId): Promise<AllocationRule | undefined>;
  list(tenantId: TenantId): Promise<AllocationRule[]>;
}

export interface TaxCodeRepository {
  save(taxCode: TaxCode): Promise<void>;
  findById(tenantId: TenantId, id: TaxCodeId): Promise<TaxCode | undefined>;
  findByCode(tenantId: TenantId, code: string): Promise<TaxCode | undefined>;
  list(tenantId: TenantId): Promise<TaxCode[]>;
}

export interface FxRateRepository {
  save(rate: FxRate): Promise<void>;
  list(tenantId: TenantId, filter?: {
    base?: string;
    quote?: string;
  }): Promise<FxRate[]>;
  /** Latest rate for the pair with asOfDate <= date. */
  findRate(tenantId: TenantId, base: string, quote: string, date: IsoDate): Promise<FxRate | undefined>;
}

export interface LedgerSettingsRepository {
  save(settings: LedgerSettings): Promise<void>;
  find(tenantId: TenantId): Promise<LedgerSettings | undefined>;
}

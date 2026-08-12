import type { TenantId } from "@enterprise-suite/shared-kernel";
import type { Account } from "../domain/account.js";
import type { AllocationRule } from "../domain/allocation.js";
import type { ApBill } from "../domain/ap-bill.js";
import type { ApPayment } from "../domain/ap-payment.js";
import type { ArInvoice } from "../domain/ar-invoice.js";
import type { ArPayment } from "../domain/ar-payment.js";
import type { CostCenter } from "../domain/cost-center.js";
import type { FxRate } from "../domain/fx-rate.js";
import type { AccountId, AllocationRuleId, ApBillId, ApPaymentId, ArInvoiceId, ArPaymentId, CostCenterId, IsoDate, JournalId, PeriodCloseRunId, TaxCodeId } from "../domain/ids.js";
import type { Journal, JournalStatus } from "../domain/journal.js";
import type { LedgerSettings } from "../domain/ledger-settings.js";
import type { PostingPeriod } from "../domain/period.js";
import type { PeriodCloseRun } from "../domain/period-close.js";
import type { TaxCode } from "../domain/tax-code.js";
import type { AccountRepository, AllocationRuleRepository, ApBillRepository, ApPaymentRepository, ArInvoiceRepository, ArPaymentRepository, CostCenterRepository, FxRateRepository, JournalRepository, LedgerSettingsRepository, PeriodCloseRunRepository, PeriodRepository, TaxCodeRepository } from "./repositories.js";
export declare class InMemoryAccountRepository implements AccountRepository {
    private readonly store;
    save(account: Account): Promise<void>;
    findById(tenantId: TenantId, id: AccountId): Promise<Account | undefined>;
    findByCode(tenantId: TenantId, code: string): Promise<Account | undefined>;
    list(tenantId: TenantId): Promise<Account[]>;
}
export declare class InMemoryJournalRepository implements JournalRepository {
    private readonly store;
    private readonly sequences;
    save(journal: Journal): Promise<void>;
    findById(tenantId: TenantId, id: JournalId): Promise<Journal | undefined>;
    list(tenantId: TenantId, filter?: {
        status?: JournalStatus;
        periodCode?: string;
        source?: string;
    }): Promise<Journal[]>;
    listByDateRange(tenantId: TenantId, startDate: IsoDate, endDate: IsoDate, status?: JournalStatus): Promise<Journal[]>;
    nextJournalNo(tenantId: TenantId): Promise<string>;
}
export declare class InMemoryPeriodRepository implements PeriodRepository {
    private readonly store;
    save(period: PostingPeriod): Promise<void>;
    findByCode(tenantId: TenantId, code: string): Promise<PostingPeriod | undefined>;
    findByDate(tenantId: TenantId, date: IsoDate): Promise<PostingPeriod | undefined>;
    list(tenantId: TenantId, fiscalYear?: number): Promise<PostingPeriod[]>;
}
export declare class InMemoryPeriodCloseRunRepository implements PeriodCloseRunRepository {
    private readonly store;
    save(run: PeriodCloseRun): Promise<void>;
    findById(tenantId: TenantId, id: PeriodCloseRunId): Promise<PeriodCloseRun | undefined>;
    findActiveForPeriod(tenantId: TenantId, periodCode: string): Promise<PeriodCloseRun | undefined>;
    list(tenantId: TenantId, periodCode?: string): Promise<PeriodCloseRun[]>;
}
export declare class InMemoryArInvoiceRepository implements ArInvoiceRepository {
    private readonly store;
    private readonly sequences;
    save(invoice: ArInvoice): Promise<void>;
    findById(tenantId: TenantId, id: ArInvoiceId): Promise<ArInvoice | undefined>;
    list(tenantId: TenantId, filter?: {
        customerId?: string;
        status?: string;
    }): Promise<ArInvoice[]>;
    nextInvoiceNo(tenantId: TenantId): Promise<string>;
}
export declare class InMemoryArPaymentRepository implements ArPaymentRepository {
    private readonly store;
    private readonly sequences;
    save(payment: ArPayment): Promise<void>;
    findById(tenantId: TenantId, id: ArPaymentId): Promise<ArPayment | undefined>;
    list(tenantId: TenantId, filter?: {
        customerId?: string;
    }): Promise<ArPayment[]>;
    nextPaymentNo(tenantId: TenantId): Promise<string>;
}
export declare class InMemoryApBillRepository implements ApBillRepository {
    private readonly store;
    private readonly sequences;
    save(bill: ApBill): Promise<void>;
    findById(tenantId: TenantId, id: ApBillId): Promise<ApBill | undefined>;
    list(tenantId: TenantId, filter?: {
        supplierId?: string;
        status?: string;
    }): Promise<ApBill[]>;
    nextBillNo(tenantId: TenantId): Promise<string>;
}
export declare class InMemoryApPaymentRepository implements ApPaymentRepository {
    private readonly store;
    private readonly sequences;
    save(payment: ApPayment): Promise<void>;
    findById(tenantId: TenantId, id: ApPaymentId): Promise<ApPayment | undefined>;
    list(tenantId: TenantId, filter?: {
        supplierId?: string;
    }): Promise<ApPayment[]>;
    nextPaymentNo(tenantId: TenantId): Promise<string>;
}
export declare class InMemoryCostCenterRepository implements CostCenterRepository {
    private readonly store;
    save(costCenter: CostCenter): Promise<void>;
    findById(tenantId: TenantId, id: CostCenterId): Promise<CostCenter | undefined>;
    findByCode(tenantId: TenantId, code: string): Promise<CostCenter | undefined>;
    list(tenantId: TenantId): Promise<CostCenter[]>;
}
export declare class InMemoryAllocationRuleRepository implements AllocationRuleRepository {
    private readonly store;
    save(rule: AllocationRule): Promise<void>;
    findById(tenantId: TenantId, id: AllocationRuleId): Promise<AllocationRule | undefined>;
    list(tenantId: TenantId): Promise<AllocationRule[]>;
}
export declare class InMemoryTaxCodeRepository implements TaxCodeRepository {
    private readonly store;
    save(taxCode: TaxCode): Promise<void>;
    findById(tenantId: TenantId, id: TaxCodeId): Promise<TaxCode | undefined>;
    findByCode(tenantId: TenantId, code: string): Promise<TaxCode | undefined>;
    list(tenantId: TenantId): Promise<TaxCode[]>;
}
export declare class InMemoryFxRateRepository implements FxRateRepository {
    private readonly store;
    save(rate: FxRate): Promise<void>;
    list(tenantId: TenantId, filter?: {
        base?: string;
        quote?: string;
    }): Promise<FxRate[]>;
    findRate(tenantId: TenantId, base: string, quote: string, date: IsoDate): Promise<FxRate | undefined>;
}
export declare class InMemoryLedgerSettingsRepository implements LedgerSettingsRepository {
    private readonly byTenant;
    save(settings: LedgerSettings): Promise<void>;
    find(tenantId: TenantId): Promise<LedgerSettings | undefined>;
}
//# sourceMappingURL=memory.d.ts.map
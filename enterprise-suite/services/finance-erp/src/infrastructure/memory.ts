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
import type { LedgerSettings } from "../domain/ledger-settings.js";
import type { PostingPeriod } from "../domain/period.js";
import type { PeriodCloseRun } from "../domain/period-close.js";
import type { TaxCode } from "../domain/tax-code.js";
import type {
  AccountRepository,
  AllocationRuleRepository,
  ApBillRepository,
  ApPaymentRepository,
  ArInvoiceRepository,
  ArPaymentRepository,
  CostCenterRepository,
  FxRateRepository,
  JournalRepository,
  LedgerSettingsRepository,
  PeriodCloseRunRepository,
  PeriodRepository,
  TaxCodeRepository,
} from "./repositories.js";

/** Per-tenant map keyed on tenantId, then entity id. */
class TenantStore<T extends { id: string; tenantId: TenantId }> {
  private readonly byTenant = new Map<TenantId, Map<string, T>>();

  save(entity: T): void {
    let bucket = this.byTenant.get(entity.tenantId);
    if (!bucket) {
      bucket = new Map();
      this.byTenant.set(entity.tenantId, bucket);
    }
    bucket.set(entity.id, entity);
  }

  get(tenantId: TenantId, id: string): T | undefined {
    return this.byTenant.get(tenantId)?.get(id);
  }

  all(tenantId: TenantId): T[] {
    return [...(this.byTenant.get(tenantId)?.values() ?? [])];
  }
}

/** Per-tenant monotonic document numbering, e.g. "JRN-000042". */
class SequenceProvider {
  private readonly counters = new Map<string, number>();

  next(tenantId: TenantId, prefix: string): string {
    const key = `${tenantId}:${prefix}`;
    const value = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, value);
    return `${prefix}-${String(value).padStart(6, "0")}`;
  }
}

export class InMemoryAccountRepository implements AccountRepository {
  private readonly store = new TenantStore<Account>();

  async save(account: Account): Promise<void> {
    this.store.save(account);
  }

  async findById(tenantId: TenantId, id: AccountId): Promise<Account | undefined> {
    return this.store.get(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<Account | undefined> {
    return this.store.all(tenantId).find((a) => a.code === code);
  }

  async list(tenantId: TenantId): Promise<Account[]> {
    return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryJournalRepository implements JournalRepository {
  private readonly store = new TenantStore<Journal>();
  private readonly sequences = new SequenceProvider();

  async save(journal: Journal): Promise<void> {
    this.store.save(journal);
  }

  async findById(tenantId: TenantId, id: JournalId): Promise<Journal | undefined> {
    return this.store.get(tenantId, id);
  }

  async list(tenantId: TenantId, filter?: {
    status?: JournalStatus;
    periodCode?: string;
    source?: string;
  }): Promise<Journal[]> {
    return this.store.all(tenantId)
      .filter((j) => !filter?.status || j.status === filter.status)
      .filter((j) => !filter?.periodCode || j.periodCode === filter.periodCode)
      .filter((j) => !filter?.source || j.source === filter.source)
      .sort((a, b) => a.journalNo.localeCompare(b.journalNo));
  }

  async listByDateRange(
    tenantId: TenantId,
    startDate: IsoDate,
    endDate: IsoDate,
    status?: JournalStatus,
  ): Promise<Journal[]> {
    return this.store.all(tenantId)
      .filter((j) => j.journalDate >= startDate && j.journalDate <= endDate)
      .filter((j) => !status || j.status === status)
      .sort((a, b) => a.journalDate.localeCompare(b.journalDate));
  }

  async nextJournalNo(tenantId: TenantId): Promise<string> {
    return this.sequences.next(tenantId, "JRN");
  }
}

export class InMemoryPeriodRepository implements PeriodRepository {
  private readonly store = new TenantStore<PostingPeriod>();

  async save(period: PostingPeriod): Promise<void> {
    this.store.save(period);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<PostingPeriod | undefined> {
    return this.store.all(tenantId).find((p) => p.code === code);
  }

  async findByDate(tenantId: TenantId, date: IsoDate): Promise<PostingPeriod | undefined> {
    return this.store.all(tenantId).find((p) => p.containsDate(date));
  }

  async list(tenantId: TenantId, fiscalYear?: number): Promise<PostingPeriod[]> {
    return this.store.all(tenantId)
      .filter((p) => fiscalYear === undefined || p.fiscalYear === fiscalYear)
      .sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryPeriodCloseRunRepository implements PeriodCloseRunRepository {
  private readonly store = new TenantStore<PeriodCloseRun>();

  async save(run: PeriodCloseRun): Promise<void> {
    this.store.save(run);
  }

  async findById(tenantId: TenantId, id: PeriodCloseRunId): Promise<PeriodCloseRun | undefined> {
    return this.store.get(tenantId, id);
  }

  async findActiveForPeriod(tenantId: TenantId, periodCode: string): Promise<PeriodCloseRun | undefined> {
    return this.store.all(tenantId).find(
      (r) => r.periodCode === periodCode && (r.status === "IN_PROGRESS" || r.status === "READY"),
    );
  }

  async list(tenantId: TenantId, periodCode?: string): Promise<PeriodCloseRun[]> {
    return this.store.all(tenantId)
      .filter((r) => !periodCode || r.periodCode === periodCode)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}

export class InMemoryArInvoiceRepository implements ArInvoiceRepository {
  private readonly store = new TenantStore<ArInvoice>();
  private readonly sequences = new SequenceProvider();

  async save(invoice: ArInvoice): Promise<void> {
    this.store.save(invoice);
  }

  async findById(tenantId: TenantId, id: ArInvoiceId): Promise<ArInvoice | undefined> {
    return this.store.get(tenantId, id);
  }

  async list(tenantId: TenantId, filter?: { customerId?: string; status?: string }): Promise<ArInvoice[]> {
    return this.store.all(tenantId)
      .filter((i) => !filter?.customerId || i.customerId === filter.customerId)
      .filter((i) => !filter?.status || i.status === filter.status)
      .sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));
  }

  async nextInvoiceNo(tenantId: TenantId): Promise<string> {
    return this.sequences.next(tenantId, "INV");
  }
}

export class InMemoryArPaymentRepository implements ArPaymentRepository {
  private readonly store = new TenantStore<ArPayment>();
  private readonly sequences = new SequenceProvider();

  async save(payment: ArPayment): Promise<void> {
    this.store.save(payment);
  }

  async findById(tenantId: TenantId, id: ArPaymentId): Promise<ArPayment | undefined> {
    return this.store.get(tenantId, id);
  }

  async list(tenantId: TenantId, filter?: { customerId?: string }): Promise<ArPayment[]> {
    return this.store.all(tenantId)
      .filter((p) => !filter?.customerId || p.customerId === filter.customerId)
      .sort((a, b) => a.paymentNo.localeCompare(b.paymentNo));
  }

  async nextPaymentNo(tenantId: TenantId): Promise<string> {
    return this.sequences.next(tenantId, "RCPT");
  }
}

export class InMemoryApBillRepository implements ApBillRepository {
  private readonly store = new TenantStore<ApBill>();
  private readonly sequences = new SequenceProvider();

  async save(bill: ApBill): Promise<void> {
    this.store.save(bill);
  }

  async findById(tenantId: TenantId, id: ApBillId): Promise<ApBill | undefined> {
    return this.store.get(tenantId, id);
  }

  async list(tenantId: TenantId, filter?: { supplierId?: string; status?: string }): Promise<ApBill[]> {
    return this.store.all(tenantId)
      .filter((b) => !filter?.supplierId || b.supplierId === filter.supplierId)
      .filter((b) => !filter?.status || b.status === filter.status)
      .sort((a, b) => a.billNo.localeCompare(b.billNo));
  }

  async nextBillNo(tenantId: TenantId): Promise<string> {
    return this.sequences.next(tenantId, "BILL");
  }
}

export class InMemoryApPaymentRepository implements ApPaymentRepository {
  private readonly store = new TenantStore<ApPayment>();
  private readonly sequences = new SequenceProvider();

  async save(payment: ApPayment): Promise<void> {
    this.store.save(payment);
  }

  async findById(tenantId: TenantId, id: ApPaymentId): Promise<ApPayment | undefined> {
    return this.store.get(tenantId, id);
  }

  async list(tenantId: TenantId, filter?: { supplierId?: string }): Promise<ApPayment[]> {
    return this.store.all(tenantId)
      .filter((p) => !filter?.supplierId || p.supplierId === filter.supplierId)
      .sort((a, b) => a.paymentNo.localeCompare(b.paymentNo));
  }

  async nextPaymentNo(tenantId: TenantId): Promise<string> {
    return this.sequences.next(tenantId, "PAY");
  }
}

export class InMemoryCostCenterRepository implements CostCenterRepository {
  private readonly store = new TenantStore<CostCenter>();

  async save(costCenter: CostCenter): Promise<void> {
    this.store.save(costCenter);
  }

  async findById(tenantId: TenantId, id: CostCenterId): Promise<CostCenter | undefined> {
    return this.store.get(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<CostCenter | undefined> {
    return this.store.all(tenantId).find((c) => c.code === code);
  }

  async list(tenantId: TenantId): Promise<CostCenter[]> {
    return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryAllocationRuleRepository implements AllocationRuleRepository {
  private readonly store = new TenantStore<AllocationRule>();

  async save(rule: AllocationRule): Promise<void> {
    this.store.save(rule);
  }

  async findById(tenantId: TenantId, id: AllocationRuleId): Promise<AllocationRule | undefined> {
    return this.store.get(tenantId, id);
  }

  async list(tenantId: TenantId): Promise<AllocationRule[]> {
    return this.store.all(tenantId).sort((a, b) => a.name.localeCompare(b.name));
  }
}

export class InMemoryTaxCodeRepository implements TaxCodeRepository {
  private readonly store = new TenantStore<TaxCode>();

  async save(taxCode: TaxCode): Promise<void> {
    this.store.save(taxCode);
  }

  async findById(tenantId: TenantId, id: TaxCodeId): Promise<TaxCode | undefined> {
    return this.store.get(tenantId, id);
  }

  async findByCode(tenantId: TenantId, code: string): Promise<TaxCode | undefined> {
    return this.store.all(tenantId).find((t) => t.code === code);
  }

  async list(tenantId: TenantId): Promise<TaxCode[]> {
    return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
  }
}

export class InMemoryFxRateRepository implements FxRateRepository {
  private readonly store = new TenantStore<FxRate>();

  async save(rate: FxRate): Promise<void> {
    this.store.save(rate);
  }

  async list(tenantId: TenantId, filter?: { base?: string; quote?: string }): Promise<FxRate[]> {
    return this.store.all(tenantId)
      .filter((r) => !filter?.base || r.baseCurrency === filter.base)
      .filter((r) => !filter?.quote || r.quoteCurrency === filter.quote)
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
  }

  async findRate(
    tenantId: TenantId,
    base: string,
    quote: string,
    date: IsoDate,
  ): Promise<FxRate | undefined> {
    return this.store.all(tenantId)
      .filter((r) => r.baseCurrency === base && r.quoteCurrency === quote && r.asOfDate <= date)
      .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];
  }
}

export class InMemoryLedgerSettingsRepository implements LedgerSettingsRepository {
  private readonly byTenant = new Map<TenantId, LedgerSettings>();

  async save(settings: LedgerSettings): Promise<void> {
    this.byTenant.set(settings.tenantId, settings);
  }

  async find(tenantId: TenantId): Promise<LedgerSettings | undefined> {
    return this.byTenant.get(tenantId);
  }
}

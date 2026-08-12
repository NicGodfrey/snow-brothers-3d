/** Per-tenant map keyed on tenantId, then entity id. */
class TenantStore {
    byTenant = new Map();
    save(entity) {
        let bucket = this.byTenant.get(entity.tenantId);
        if (!bucket) {
            bucket = new Map();
            this.byTenant.set(entity.tenantId, bucket);
        }
        bucket.set(entity.id, entity);
    }
    get(tenantId, id) {
        return this.byTenant.get(tenantId)?.get(id);
    }
    all(tenantId) {
        return [...(this.byTenant.get(tenantId)?.values() ?? [])];
    }
}
/** Per-tenant monotonic document numbering, e.g. "JRN-000042". */
class SequenceProvider {
    counters = new Map();
    next(tenantId, prefix) {
        const key = `${tenantId}:${prefix}`;
        const value = (this.counters.get(key) ?? 0) + 1;
        this.counters.set(key, value);
        return `${prefix}-${String(value).padStart(6, "0")}`;
    }
}
export class InMemoryAccountRepository {
    store = new TenantStore();
    async save(account) {
        this.store.save(account);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByCode(tenantId, code) {
        return this.store.all(tenantId).find((a) => a.code === code);
    }
    async list(tenantId) {
        return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
    }
}
export class InMemoryJournalRepository {
    store = new TenantStore();
    sequences = new SequenceProvider();
    async save(journal) {
        this.store.save(journal);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId)
            .filter((j) => !filter?.status || j.status === filter.status)
            .filter((j) => !filter?.periodCode || j.periodCode === filter.periodCode)
            .filter((j) => !filter?.source || j.source === filter.source)
            .sort((a, b) => a.journalNo.localeCompare(b.journalNo));
    }
    async listByDateRange(tenantId, startDate, endDate, status) {
        return this.store.all(tenantId)
            .filter((j) => j.journalDate >= startDate && j.journalDate <= endDate)
            .filter((j) => !status || j.status === status)
            .sort((a, b) => a.journalDate.localeCompare(b.journalDate));
    }
    async nextJournalNo(tenantId) {
        return this.sequences.next(tenantId, "JRN");
    }
}
export class InMemoryPeriodRepository {
    store = new TenantStore();
    async save(period) {
        this.store.save(period);
    }
    async findByCode(tenantId, code) {
        return this.store.all(tenantId).find((p) => p.code === code);
    }
    async findByDate(tenantId, date) {
        return this.store.all(tenantId).find((p) => p.containsDate(date));
    }
    async list(tenantId, fiscalYear) {
        return this.store.all(tenantId)
            .filter((p) => fiscalYear === undefined || p.fiscalYear === fiscalYear)
            .sort((a, b) => a.code.localeCompare(b.code));
    }
}
export class InMemoryPeriodCloseRunRepository {
    store = new TenantStore();
    async save(run) {
        this.store.save(run);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findActiveForPeriod(tenantId, periodCode) {
        return this.store.all(tenantId).find((r) => r.periodCode === periodCode && (r.status === "IN_PROGRESS" || r.status === "READY"));
    }
    async list(tenantId, periodCode) {
        return this.store.all(tenantId)
            .filter((r) => !periodCode || r.periodCode === periodCode)
            .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }
}
export class InMemoryArInvoiceRepository {
    store = new TenantStore();
    sequences = new SequenceProvider();
    async save(invoice) {
        this.store.save(invoice);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId)
            .filter((i) => !filter?.customerId || i.customerId === filter.customerId)
            .filter((i) => !filter?.status || i.status === filter.status)
            .sort((a, b) => a.invoiceNo.localeCompare(b.invoiceNo));
    }
    async nextInvoiceNo(tenantId) {
        return this.sequences.next(tenantId, "INV");
    }
}
export class InMemoryArPaymentRepository {
    store = new TenantStore();
    sequences = new SequenceProvider();
    async save(payment) {
        this.store.save(payment);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId)
            .filter((p) => !filter?.customerId || p.customerId === filter.customerId)
            .sort((a, b) => a.paymentNo.localeCompare(b.paymentNo));
    }
    async nextPaymentNo(tenantId) {
        return this.sequences.next(tenantId, "RCPT");
    }
}
export class InMemoryApBillRepository {
    store = new TenantStore();
    sequences = new SequenceProvider();
    async save(bill) {
        this.store.save(bill);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId)
            .filter((b) => !filter?.supplierId || b.supplierId === filter.supplierId)
            .filter((b) => !filter?.status || b.status === filter.status)
            .sort((a, b) => a.billNo.localeCompare(b.billNo));
    }
    async nextBillNo(tenantId) {
        return this.sequences.next(tenantId, "BILL");
    }
}
export class InMemoryApPaymentRepository {
    store = new TenantStore();
    sequences = new SequenceProvider();
    async save(payment) {
        this.store.save(payment);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId)
            .filter((p) => !filter?.supplierId || p.supplierId === filter.supplierId)
            .sort((a, b) => a.paymentNo.localeCompare(b.paymentNo));
    }
    async nextPaymentNo(tenantId) {
        return this.sequences.next(tenantId, "PAY");
    }
}
export class InMemoryCostCenterRepository {
    store = new TenantStore();
    async save(costCenter) {
        this.store.save(costCenter);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByCode(tenantId, code) {
        return this.store.all(tenantId).find((c) => c.code === code);
    }
    async list(tenantId) {
        return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
    }
}
export class InMemoryAllocationRuleRepository {
    store = new TenantStore();
    async save(rule) {
        this.store.save(rule);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async list(tenantId) {
        return this.store.all(tenantId).sort((a, b) => a.name.localeCompare(b.name));
    }
}
export class InMemoryTaxCodeRepository {
    store = new TenantStore();
    async save(taxCode) {
        this.store.save(taxCode);
    }
    async findById(tenantId, id) {
        return this.store.get(tenantId, id);
    }
    async findByCode(tenantId, code) {
        return this.store.all(tenantId).find((t) => t.code === code);
    }
    async list(tenantId) {
        return this.store.all(tenantId).sort((a, b) => a.code.localeCompare(b.code));
    }
}
export class InMemoryFxRateRepository {
    store = new TenantStore();
    async save(rate) {
        this.store.save(rate);
    }
    async list(tenantId, filter) {
        return this.store.all(tenantId)
            .filter((r) => !filter?.base || r.baseCurrency === filter.base)
            .filter((r) => !filter?.quote || r.quoteCurrency === filter.quote)
            .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate));
    }
    async findRate(tenantId, base, quote, date) {
        return this.store.all(tenantId)
            .filter((r) => r.baseCurrency === base && r.quoteCurrency === quote && r.asOfDate <= date)
            .sort((a, b) => b.asOfDate.localeCompare(a.asOfDate))[0];
    }
}
export class InMemoryLedgerSettingsRepository {
    byTenant = new Map();
    async save(settings) {
        this.byTenant.set(settings.tenantId, settings);
    }
    async find(tenantId) {
        return this.byTenant.get(tenantId);
    }
}
//# sourceMappingURL=memory.js.map
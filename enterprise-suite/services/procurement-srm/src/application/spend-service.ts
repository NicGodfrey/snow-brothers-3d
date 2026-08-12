import { money, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import {
  compareDates,
  currencyCode,
  daysBetween,
  extendPrice,
  isWithin,
  varianceBps,
  type IsoDate,
} from "../domain/common.js";
import type { PurchaseOrder } from "../domain/purchase-order.js";
import {
  commit,
  type AgreementRepository,
  type Clock,
  type EventOutbox,
  type InvoiceRepository,
  type PurchaseOrderRepository,
  type ReceiptRepository,
  type RequisitionRepository,
  type RfqRepository,
  type SupplierDirectoryRepository,
} from "./ports.js";

export interface SpendWindow {
  /** Inclusive start of the analysis window; defaults to all history. */
  readonly from?: IsoDate;
  /** Inclusive end of the analysis window; defaults to today. */
  readonly to?: IsoDate;
  readonly currency: string;
}

export interface SpendBucket {
  readonly key: string;
  readonly label: string;
  readonly orderedValue: Money;
  readonly receivedValue: Money;
  readonly invoicedValue: Money;
  readonly orderCount: number;
  readonly shareBps: number;
}

export interface SupplierPerformance {
  readonly supplierId: Ulid;
  readonly supplierName: string;
  readonly orderCount: number;
  readonly orderedValue: Money;
  readonly receivedValue: Money;
  readonly onTimeLineCount: number;
  readonly deliveredLineCount: number;
  readonly onTimeBps: number;
  readonly rejectedQuantity: number;
  readonly qualityBps: number;
  readonly openExceptionCount: number;
}

export interface SourcingSavings {
  readonly rfqId: Ulid;
  readonly rfqNumber: string;
  readonly baseline: Money;
  readonly awarded: Money;
  readonly saving: Money;
  readonly savingBps: number;
}

export interface CycleTimeStats {
  readonly sampleSize: number;
  readonly averageDays: number;
  readonly medianDays: number;
  readonly p90Days: number;
}

/**
 * Read-side analytics computed on demand from the aggregates.
 *
 * A production deployment would fold `procurement.*` events into projection
 * tables in reporting-bi; the queries here are deliberately the same shape so
 * that swap does not change any caller.
 */
export class SpendAnalyticsService {
  constructor(
    private readonly orders: PurchaseOrderRepository,
    private readonly requisitions: RequisitionRepository,
    private readonly receipts: ReceiptRepository,
    private readonly invoices: InvoiceRepository,
    private readonly agreements: AgreementRepository,
    private readonly rfqs: RfqRepository,
    private readonly suppliers: SupplierDirectoryRepository,
    private readonly clock: Clock,
    private readonly outbox: EventOutbox,
  ) {}

  spendBySupplier(tenantId: TenantId, window: SpendWindow): SpendBucket[] {
    const orders = this.ordersInWindow(tenantId, window);
    const buckets = new Map<string, { ordered: number; received: number; invoiced: number; count: number }>();
    for (const order of orders) {
      const bucket = buckets.get(order.supplierId) ?? { ordered: 0, received: 0, invoiced: 0, count: 0 };
      bucket.ordered += order.netTotal.amountMinor;
      bucket.received += order.receivedValue.amountMinor;
      bucket.invoiced += order.invoicedValue.amountMinor;
      bucket.count += 1;
      buckets.set(order.supplierId, bucket);
    }
    return this.toBuckets(tenantId, buckets, window.currency, (key) => {
      const supplier = this.suppliers.findById(tenantId, key as Ulid);
      return supplier ? `${supplier.supplierNumber} ${supplier.displayName}` : key;
    });
  }

  spendByCategory(tenantId: TenantId, window: SpendWindow): SpendBucket[] {
    const orders = this.ordersInWindow(tenantId, window);
    const buckets = new Map<string, { ordered: number; received: number; invoiced: number; count: number }>();
    for (const order of orders) {
      const seenCategories = new Set<string>();
      for (const line of order.lines) {
        if (line.status === "cancelled") continue;
        const bucket = buckets.get(line.categoryCode) ?? {
          ordered: 0,
          received: 0,
          invoiced: 0,
          count: 0,
        };
        bucket.ordered += line.netAmount.amountMinor;
        bucket.received += line.receivedValue.amountMinor;
        bucket.invoiced += line.invoicedAmount.amountMinor;
        if (!seenCategories.has(line.categoryCode)) {
          bucket.count += 1;
          seenCategories.add(line.categoryCode);
        }
        buckets.set(line.categoryCode, bucket);
      }
    }
    return this.toBuckets(tenantId, buckets, window.currency, (key) => key);
  }

  /**
   * Spend attributed to the requesting cost centre. Orders raised without a
   * requisition land in `UNASSIGNED`, which is exactly the maverick-buying
   * figure a category manager wants to see.
   */
  spendByCostCenter(tenantId: TenantId, window: SpendWindow): SpendBucket[] {
    const orders = this.ordersInWindow(tenantId, window);
    const buckets = new Map<string, { ordered: number; received: number; invoiced: number; count: number }>();
    for (const order of orders) {
      const costCenters = new Set<string>();
      for (const requisitionId of order.requisitionIds) {
        const requisition = this.requisitions.findById(tenantId, requisitionId);
        if (requisition) costCenters.add(requisition.costCenter);
      }
      const keys = costCenters.size > 0 ? [...costCenters] : ["UNASSIGNED"];
      const share = order.netTotal.amountMinor / keys.length;
      for (const key of keys) {
        const bucket = buckets.get(key) ?? { ordered: 0, received: 0, invoiced: 0, count: 0 };
        bucket.ordered += Math.round(share);
        bucket.received += Math.round(order.receivedValue.amountMinor / keys.length);
        bucket.invoiced += Math.round(order.invoicedValue.amountMinor / keys.length);
        bucket.count += 1;
        buckets.set(key, bucket);
      }
    }
    return this.toBuckets(tenantId, buckets, window.currency, (key) => key);
  }

  /** Share of ordered value placed against a blanket agreement. */
  contractCoverageBps(tenantId: TenantId, window: SpendWindow): { onContract: Money; offContract: Money; coverageBps: number } {
    const currency = currencyCode(window.currency);
    let onContract = 0;
    let offContract = 0;
    for (const order of this.ordersInWindow(tenantId, window)) {
      if (order.agreementId) onContract += order.netTotal.amountMinor;
      else offContract += order.netTotal.amountMinor;
    }
    const total = onContract + offContract;
    return {
      onContract: money(onContract, currency),
      offContract: money(offContract, currency),
      coverageBps: total === 0 ? 0 : Math.round((onContract / total) * 10_000),
    };
  }

  supplierPerformance(tenantId: TenantId, window: SpendWindow): SupplierPerformance[] {
    const currency = currencyCode(window.currency);
    const orders = this.ordersInWindow(tenantId, window);
    const bySupplier = new Map<Ulid, PurchaseOrder[]>();
    for (const order of orders) {
      const existing = bySupplier.get(order.supplierId) ?? [];
      existing.push(order);
      bySupplier.set(order.supplierId, existing);
    }

    const results: SupplierPerformance[] = [];
    for (const [supplierId, supplierOrders] of bySupplier) {
      const supplier = this.suppliers.findById(tenantId, supplierId);
      let onTime = 0;
      let delivered = 0;
      let rejected = 0;
      for (const receipt of this.receipts.listBySupplier(tenantId, supplierId)) {
        if (receipt.status !== "posted") continue;
        const order = supplierOrders.find((candidate) => candidate.id === receipt.purchaseOrderId);
        if (!order) continue;
        for (const receiptLine of receipt.lines) {
          const orderLine = order.lines.find(
            (line) => line.lineNumber === receiptLine.purchaseOrderLineNumber,
          );
          if (!orderLine) continue;
          delivered += 1;
          rejected += receiptLine.rejectedQuantity;
          const due = orderLine.promisedDate ?? orderLine.needBy;
          if (compareDates(receipt.receiptDate, due) <= 0) onTime += 1;
        }
      }
      const openExceptions = this.invoices
        .listBySupplier(tenantId, supplierId)
        .reduce((total, invoice) => total + invoice.openExceptions.length, 0);
      results.push({
        supplierId,
        supplierName: supplier?.displayName ?? supplierId,
        orderCount: supplierOrders.length,
        orderedValue: money(
          supplierOrders.reduce((total, order) => total + order.netTotal.amountMinor, 0),
          currency,
        ),
        receivedValue: money(
          supplierOrders.reduce((total, order) => total + order.receivedValue.amountMinor, 0),
          currency,
        ),
        onTimeLineCount: onTime,
        deliveredLineCount: delivered,
        onTimeBps: delivered === 0 ? 0 : Math.round((onTime / delivered) * 10_000),
        rejectedQuantity: Math.round(rejected * 1e6) / 1e6,
        qualityBps: supplier?.qualityScoreBps ?? 0,
        openExceptionCount: openExceptions,
      });
    }
    return results.sort((a, b) => b.orderedValue.amountMinor - a.orderedValue.amountMinor);
  }

  /**
   * Savings realised at award: the requisition estimate for the awarded lines
   * against what the winning quotes actually charged.
   */
  sourcingSavings(tenantId: TenantId, currency: string): SourcingSavings[] {
    const target = currencyCode(currency);
    const results: SourcingSavings[] = [];
    for (const rfq of this.rfqs.listByStatus(tenantId, "awarded")) {
      if (rfq.currency !== target) continue;
      let baselineMinor = 0;
      let awardedMinor = 0;
      for (const award of rfq.awards) {
        for (const lineNumber of award.lineNumbers) {
          const rfqLine = rfq.lines.find((line) => line.lineNumber === lineNumber);
          if (!rfqLine) continue;
          const order = this.orders
            .listByTenant(tenantId)
            .find((candidate) => candidate.quoteId === award.quoteId);
          const orderLine = order?.lines.find((line) => line.rfqLineNumber === lineNumber);
          if (orderLine) awardedMinor += orderLine.netAmount.amountMinor;
          if (rfqLine.requisitionId && rfqLine.requisitionLineId) {
            const requisition = this.requisitions.findById(tenantId, rfqLine.requisitionId);
            const requisitionLine = requisition?.lines.find(
              (line) => line.id === rfqLine.requisitionLineId,
            );
            if (requisitionLine) {
              baselineMinor += extendPrice(requisitionLine.estimatedUnitPrice, rfqLine.quantity).amountMinor;
            }
          }
        }
      }
      if (baselineMinor === 0) continue;
      const savingMinor = baselineMinor - awardedMinor;
      results.push({
        rfqId: rfq.id,
        rfqNumber: rfq.rfqNumber,
        baseline: money(baselineMinor, target),
        awarded: money(awardedMinor, target),
        saving: money(savingMinor, target),
        savingBps: -varianceBps(awardedMinor, baselineMinor),
      });
    }
    return results.sort((a, b) => b.saving.amountMinor - a.saving.amountMinor);
  }

  /** Days from requisition submission to the first purchase order. */
  requisitionCycleTime(tenantId: TenantId): CycleTimeStats {
    const durations: number[] = [];
    for (const requisition of this.requisitions.listByTenant(tenantId)) {
      const orders = this.orders.listByRequisition(tenantId, requisition.id);
      if (orders.length === 0) continue;
      const first = orders
        .map((order) => order.orderDate)
        .sort(compareDates)[0];
      durations.push(Math.max(0, daysBetween(requisition.createdAt.slice(0, 10) as IsoDate, first)));
    }
    return summarize(durations);
  }

  /** Value ordered but not yet received, by supplier. */
  openCommitments(tenantId: TenantId, currency: string): Array<{ supplierId: Ulid; supplierName: string; outstanding: Money }> {
    const target = currencyCode(currency);
    const totals = new Map<Ulid, number>();
    for (const order of this.orders.listOpen(tenantId)) {
      if (order.currency !== target) continue;
      totals.set(order.supplierId, (totals.get(order.supplierId) ?? 0) + order.outstandingValue.amountMinor);
    }
    return [...totals.entries()]
      .map(([supplierId, minor]) => ({
        supplierId,
        supplierName: this.suppliers.findById(tenantId, supplierId)?.displayName ?? supplierId,
        outstanding: money(minor, target),
      }))
      .sort((a, b) => b.outstanding.amountMinor - a.outstanding.amountMinor);
  }

  /** Received-not-invoiced accrual across every open order. */
  goodsReceivedNotInvoiced(tenantId: TenantId, currency: string): Money {
    const target = currencyCode(currency);
    const minor = this.orders
      .listByTenant(tenantId)
      .filter((order) => order.currency === target)
      .reduce(
        (total, order) =>
          total +
          order.lines.reduce(
            (lineTotal, line) =>
              lineTotal + Math.round(line.netUnitPrice.amountMinor * line.uninvoicedQuantity),
            0,
          ),
        0,
      );
    return money(minor, target);
  }

  /** One call for a buyer dashboard. */
  dashboard(tenantId: TenantId, currency: string): {
    currency: string;
    asOf: IsoDate;
    openRequisitions: number;
    pendingApprovals: number;
    openOrders: number;
    openCommitment: Money;
    goodsReceivedNotInvoiced: Money;
    invoiceExceptions: number;
    expiringAgreements: number;
    topSuppliers: SpendBucket[];
  } {
    const today = this.clock.today();
    const target = currencyCode(currency);
    const window: SpendWindow = { currency: target };
    return {
      currency: target,
      asOf: today,
      openRequisitions:
        this.requisitions.listByStatus(tenantId, "approved").length +
        this.requisitions.listByStatus(tenantId, "partially_ordered").length,
      pendingApprovals: this.requisitions.listByStatus(tenantId, "pending_approval").length,
      openOrders: this.orders.listOpen(tenantId).length,
      openCommitment: money(
        this.orders
          .listOpen(tenantId)
          .filter((order) => order.currency === target)
          .reduce((total, order) => total + order.outstandingValue.amountMinor, 0),
        target,
      ),
      goodsReceivedNotInvoiced: this.goodsReceivedNotInvoiced(tenantId, target),
      invoiceExceptions: this.invoices.listByStatus(tenantId, "exception").length,
      expiringAgreements: this.agreements
        .listByTenant(tenantId)
        .filter((agreement) => agreement.isRenewalDue(today)).length,
      topSuppliers: this.spendBySupplier(tenantId, window).slice(0, 5),
    };
  }

  /** Undispatched integration events, for the outbox monitoring endpoint. */
  outboxDepth(): number {
    return this.outbox.peek().length;
  }

  private ordersInWindow(tenantId: TenantId, window: SpendWindow): PurchaseOrder[] {
    const target = currencyCode(window.currency);
    return this.orders.listByTenant(tenantId).filter((order) => {
      if (order.currency !== target) return false;
      if (order.status === "draft" || order.status === "cancelled") return false;
      if (window.from || window.to) {
        return isWithin(order.orderDate, window.from ?? order.orderDate, window.to);
      }
      return true;
    });
  }

  private toBuckets(
    tenantId: TenantId,
    buckets: Map<string, { ordered: number; received: number; invoiced: number; count: number }>,
    currency: string,
    label: (key: string) => string,
  ): SpendBucket[] {
    const target = currencyCode(currency);
    const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.ordered, 0);
    return [...buckets.entries()]
      .map(([key, bucket]) => ({
        key,
        label: label(key),
        orderedValue: money(bucket.ordered, target),
        receivedValue: money(bucket.received, target),
        invoicedValue: money(bucket.invoiced, target),
        orderCount: bucket.count,
        shareBps: total === 0 ? 0 : Math.round((bucket.ordered / total) * 10_000),
      }))
      .sort((a, b) => b.orderedValue.amountMinor - a.orderedValue.amountMinor);
  }
}

function summarize(values: readonly number[]): CycleTimeStats {
  if (values.length === 0) {
    return { sampleSize: 0, averageDays: 0, medianDays: 0, p90Days: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const average = sorted.reduce((total, value) => total + value, 0) / sorted.length;
  const percentile = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return {
    sampleSize: sorted.length,
    averageDays: Math.round(average * 100) / 100,
    medianDays: percentile(0.5),
    p90Days: percentile(0.9),
  };
}

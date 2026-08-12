import {
  ConflictError,
  NotFoundError,
  assertTransition,
  type CurrencyCode,
  type TenantId,
  type Ulid,
  currency,
} from "../../kernel/index.js";
import { AggregateRoot } from "../../kernel/aggregate.js";
import type { Address } from "../accounts/address.js";
import type { CreditCheckResult } from "../accounts/credit-policy.js";
import type { TaxCalculator } from "../pricing/tax.js";
import { computeTotals, type DocumentTotals } from "../quotes/calculator.js";
import type { Quote } from "../quotes/quote.js";
import {
  asQuoteLine,
  createOrderLine,
  isFullyAllocated,
  isFullyShipped,
  orderLineFromQuoteLine,
  type OrderLine,
  type OrderLineInput,
} from "./order-line.js";
import { CANCELLABLE_ORDER_STATUSES, ORDER_STATUS_MACHINE, type OrderStatus } from "./status.js";
import { OrderEventTypes, orderEvent } from "./events.js";

export interface SalesOrderProps {
  orderNumber: string;
  accountId: Ulid;
  quoteId?: Ulid;
  currency: CurrencyCode;
  taxRegion: string;
  status: OrderStatus;
  lines: OrderLine[];
  shippingAddress?: Address;
  creditDecision?: CreditCheckResult;
  cancellationReason?: string;
  notes?: string;
}

export class SalesOrder extends AggregateRoot<SalesOrderProps> {
  private constructor(tenantId: TenantId, props: SalesOrderProps) {
    super(tenantId, props);
  }

  static createDraft(
    tenantId: TenantId,
    input: {
      orderNumber: string;
      accountId: Ulid;
      currency: string;
      taxRegion: string;
      shippingAddress?: Address;
      notes?: string;
    },
  ): SalesOrder {
    const order = new SalesOrder(tenantId, {
      orderNumber: input.orderNumber,
      accountId: input.accountId,
      currency: currency(input.currency),
      taxRegion: input.taxRegion.toUpperCase(),
      status: ORDER_STATUS_MACHINE.initial,
      lines: [],
      shippingAddress: input.shippingAddress,
      notes: input.notes,
    });
    order.raiseCreated();
    return order;
  }

  /** Copies lines and commercial terms from an accepted quote. */
  static fromQuote(
    tenantId: TenantId,
    orderNumber: string,
    quote: Quote,
    shippingAddress?: Address,
  ): SalesOrder {
    if (quote.status !== "accepted") {
      throw new ConflictError(
        `Order can only be created from an accepted quote (quote ${quote.quoteNumber} is ${quote.status})`,
      );
    }
    if (quote.lines.length === 0) {
      throw new ConflictError(`Quote ${quote.quoteNumber} has no lines`);
    }
    const order = new SalesOrder(tenantId, {
      orderNumber,
      accountId: quote.accountId,
      quoteId: quote.id,
      currency: quote.currencyCode,
      taxRegion: quote.taxRegion,
      status: ORDER_STATUS_MACHINE.initial,
      lines: quote.lines.map(orderLineFromQuoteLine),
      shippingAddress,
    });
    order.raiseCreated();
    return order;
  }

  get orderNumber(): string {
    return this.props.orderNumber;
  }

  get accountId(): Ulid {
    return this.props.accountId;
  }

  get quoteId(): Ulid | undefined {
    return this.props.quoteId;
  }

  get status(): OrderStatus {
    return this.props.status;
  }

  get currencyCode(): CurrencyCode {
    return this.props.currency;
  }

  get taxRegion(): string {
    return this.props.taxRegion;
  }

  get lines(): readonly OrderLine[] {
    return this.props.lines;
  }

  get creditDecision(): CreditCheckResult | undefined {
    return this.props.creditDecision;
  }

  get isOpenExposure(): boolean {
    return ["confirmed", "allocated", "shipped"].includes(this.props.status);
  }

  totals(taxCalculator?: TaxCalculator): DocumentTotals {
    return computeTotals(
      this.props.lines.map(asQuoteLine),
      this.props.currency,
      this.props.taxRegion,
      taxCalculator,
    );
  }

  addLine(input: Omit<OrderLineInput, "currency">): OrderLine {
    this.assertDraft("add lines to");
    const line = createOrderLine({ ...input, currency: this.props.currency });
    this.props.lines.push(line);
    this.touch();
    return line;
  }

  removeLine(lineId: Ulid): void {
    this.assertDraft("remove lines from");
    const idx = this.props.lines.findIndex((l) => l.lineId === lineId);
    if (idx === -1) throw new NotFoundError("OrderLine", lineId as unknown as string);
    this.props.lines.splice(idx, 1);
    this.touch();
  }

  lineById(lineId: Ulid): OrderLine {
    const line = this.props.lines.find((l) => l.lineId === lineId);
    if (!line) throw new NotFoundError("OrderLine", lineId as unknown as string);
    return line;
  }

  confirm(creditDecision: CreditCheckResult): void {
    assertTransition(ORDER_STATUS_MACHINE, this.props.status, "confirmed");
    if (this.props.lines.length === 0) {
      throw new ConflictError(`Order ${this.props.orderNumber} has no lines`);
    }
    if (creditDecision.decision === "declined") {
      throw new ConflictError(
        `Order ${this.props.orderNumber} failed credit check: ${creditDecision.reasons.join("; ")}`,
        creditDecision,
      );
    }
    this.props.status = "confirmed";
    this.props.creditDecision = creditDecision;
    const totals = this.totals();
    this.raise(
      orderEvent(OrderEventTypes.OrderConfirmed, this.id, this.tenantId, {
        orderNumber: this.props.orderNumber,
        accountId: this.props.accountId as unknown as string,
        grandTotalMinor: totals.grandTotal.amountMinor as unknown as number,
        currency: this.props.currency as unknown as string,
        creditDecision: creditDecision.decision,
        quoteId: this.props.quoteId as unknown as string | undefined,
      }),
    );
  }

  /**
   * Record inventory allocations per line. The order reaches `allocated`
   * once every line is fully allocated.
   */
  allocate(allocations: readonly { lineId: Ulid; qty: number }[]): void {
    if (this.props.status !== "confirmed") {
      throw new ConflictError(
        `Order ${this.props.orderNumber} must be confirmed to allocate (is ${this.props.status})`,
      );
    }
    if (allocations.length === 0) throw new ConflictError("No allocations given");
    for (const alloc of allocations) {
      if (!Number.isInteger(alloc.qty) || alloc.qty < 1) {
        throw new ConflictError(`Allocation qty must be a positive integer (got ${alloc.qty})`);
      }
      const line = this.lineById(alloc.lineId);
      const newAllocated = line.qtyAllocated + alloc.qty;
      if (newAllocated > line.qty) {
        throw new ConflictError(
          `Cannot allocate ${alloc.qty} for line ${line.sku}: ${line.qtyAllocated}/${line.qty} already allocated`,
        );
      }
      this.replaceLine({ ...line, qtyAllocated: newAllocated });
    }
    if (this.props.lines.every(isFullyAllocated)) {
      assertTransition(ORDER_STATUS_MACHINE, this.props.status, "allocated");
      this.props.status = "allocated";
      this.raise(
        orderEvent(OrderEventTypes.OrderAllocated, this.id, this.tenantId, {
          orderNumber: this.props.orderNumber,
          accountId: this.props.accountId as unknown as string,
        }),
      );
    } else {
      this.touch();
    }
  }

  /**
   * Record shipments per line. The order reaches `shipped` once every line
   * is fully shipped. Only allocated quantities can ship.
   */
  ship(shipments: readonly { lineId: Ulid; qty: number }[]): void {
    if (this.props.status !== "allocated") {
      throw new ConflictError(
        `Order ${this.props.orderNumber} must be allocated to ship (is ${this.props.status})`,
      );
    }
    if (shipments.length === 0) throw new ConflictError("No shipments given");
    const shipped: { lineId: string; sku: string; qty: number }[] = [];
    for (const shipment of shipments) {
      if (!Number.isInteger(shipment.qty) || shipment.qty < 1) {
        throw new ConflictError(`Shipment qty must be a positive integer (got ${shipment.qty})`);
      }
      const line = this.lineById(shipment.lineId);
      const newShipped = line.qtyShipped + shipment.qty;
      if (newShipped > line.qtyAllocated) {
        throw new ConflictError(
          `Cannot ship ${shipment.qty} for line ${line.sku}: only ${line.qtyAllocated - line.qtyShipped} allocated units remain`,
        );
      }
      this.replaceLine({ ...line, qtyShipped: newShipped });
      shipped.push({
        lineId: line.lineId as unknown as string,
        sku: line.sku as unknown as string,
        qty: shipment.qty,
      });
    }
    const fullyShipped = this.props.lines.every(isFullyShipped);
    if (fullyShipped) {
      assertTransition(ORDER_STATUS_MACHINE, this.props.status, "shipped");
      this.props.status = "shipped";
    }
    this.raise(
      orderEvent(OrderEventTypes.OrderShipped, this.id, this.tenantId, {
        orderNumber: this.props.orderNumber,
        accountId: this.props.accountId as unknown as string,
        shipments: shipped,
        fullyShipped,
      }),
    );
  }

  invoice(): void {
    assertTransition(ORDER_STATUS_MACHINE, this.props.status, "invoiced");
    this.props.status = "invoiced";
    this.raise(
      orderEvent(OrderEventTypes.OrderInvoiced, this.id, this.tenantId, {
        orderNumber: this.props.orderNumber,
        accountId: this.props.accountId as unknown as string,
        grandTotalMinor: this.totals().grandTotal.amountMinor as unknown as number,
        currency: this.props.currency as unknown as string,
      }),
    );
  }

  close(): void {
    assertTransition(ORDER_STATUS_MACHINE, this.props.status, "closed");
    this.props.status = "closed";
    this.raise(
      orderEvent(OrderEventTypes.OrderClosed, this.id, this.tenantId, {
        orderNumber: this.props.orderNumber,
        accountId: this.props.accountId as unknown as string,
      }),
    );
  }

  cancel(reason: string): void {
    if (!CANCELLABLE_ORDER_STATUSES.includes(this.props.status)) {
      throw new ConflictError(
        `Order ${this.props.orderNumber} cannot be cancelled after shipping (is ${this.props.status})`,
      );
    }
    assertTransition(ORDER_STATUS_MACHINE, this.props.status, "cancelled");
    if (!reason.trim()) throw new ConflictError("A cancellation reason is required");
    const previousStatus = this.props.status;
    this.props.status = "cancelled";
    this.props.cancellationReason = reason.trim();
    this.raise(
      orderEvent(OrderEventTypes.OrderCancelled, this.id, this.tenantId, {
        orderNumber: this.props.orderNumber,
        accountId: this.props.accountId as unknown as string,
        reason: this.props.cancellationReason,
        previousStatus,
      }),
    );
  }

  private replaceLine(line: OrderLine): void {
    const idx = this.props.lines.findIndex((l) => l.lineId === line.lineId);
    this.props.lines[idx] = line;
  }

  private raiseCreated(): void {
    this.raise(
      orderEvent(OrderEventTypes.OrderCreated, this.id, this.tenantId, {
        orderNumber: this.props.orderNumber,
        accountId: this.props.accountId as unknown as string,
        quoteId: this.props.quoteId as unknown as string | undefined,
      }),
    );
  }

  private assertDraft(action: string): void {
    if (this.props.status !== "draft") {
      throw new ConflictError(
        `Cannot ${action} order ${this.props.orderNumber} in status ${this.props.status}`,
      );
    }
  }
}

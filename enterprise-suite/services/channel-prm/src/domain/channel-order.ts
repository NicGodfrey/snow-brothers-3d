import {
  AggregateRoot,
  envelope,
  type EntityProps,
  type IsoDateTime,
  type Money,
  type TenantId,
  type Ulid,
  type UserId,
} from "@enterprise-suite/shared-kernel";
import type { ExternalRef } from "./channel-quote.js";
import { InvalidStateError, ValidationError } from "./errors.js";
import { ChannelEventTypes } from "./events.js";
import { assertPositiveMoney, discountBpsOf, zeroMoney } from "./money-math.js";
import { assertIso } from "./protection.js";
import type { CustomerKey } from "./territory.js";

/**
 * Channel order — the channel-side reference to a booked sales order.
 *
 *   placed ─invoice→ invoiced ─fulfil→ fulfilled
 *      └──────────────cancel→ cancelled
 *
 * sales-erp owns the order: lines, fulfilment, revenue recognition. What the
 * channel needs is the attribution (which partner, from which registration or
 * quote) and the booked value, because that is what feeds partner attainment,
 * tier reviews and sourced-vs-influenced reporting.
 */

export type ChannelOrderStatus = "placed" | "invoiced" | "fulfilled" | "cancelled";

export const CHANNEL_ORDER_STATUSES: readonly ChannelOrderStatus[] = [
  "placed",
  "invoiced",
  "fulfilled",
  "cancelled",
];

/**
 * How the deal reached the vendor.
 * - `partner_sourced`: the partner brought it and holds/held protection
 * - `vendor_sourced`: the vendor found it and handed it to a partner to transact
 * - `co_sell`: worked jointly; credited to both sides at reduced weight
 */
export type OrderSourceType = "partner_sourced" | "vendor_sourced" | "co_sell";

export const ORDER_SOURCE_TYPES: readonly OrderSourceType[] = ["partner_sourced", "vendor_sourced", "co_sell"];

export interface ChannelOrderProps {
  number: string;
  partnerId: Ulid;
  registrationId?: Ulid;
  channelQuoteId?: Ulid;
  customerKey: CustomerKey;
  customerName: string;
  salesOrderRef: ExternalRef;
  /** Net booked value, after channel discount. */
  netValue: Money;
  /** Undiscounted value, when known; drives realised-discount reporting. */
  listValue?: Money;
  sourceType: OrderSourceType;
  status: ChannelOrderStatus;
  orderedAt: IsoDateTime;
  invoicedAt?: IsoDateTime;
  invoiceRef?: ExternalRef;
  fulfilledAt?: IsoDateTime;
  cancelledAt?: IsoDateTime;
  cancelledReason?: string;
  /** Partner margin on the transaction, in basis points off list. */
  partnerMarginBps?: number;
  poNumber?: string;
}

export interface CreateChannelOrderInput {
  readonly number: string;
  readonly partnerId: Ulid;
  readonly registrationId?: Ulid;
  readonly channelQuoteId?: Ulid;
  readonly customerKey: CustomerKey;
  readonly customerName: string;
  readonly salesOrderRef: ExternalRef;
  readonly netValue: Money;
  readonly listValue?: Money;
  readonly sourceType?: OrderSourceType;
  readonly orderedAt: IsoDateTime;
  readonly poNumber?: string;
}

export class ChannelOrder extends AggregateRoot<ChannelOrderProps> {
  static place(tenantId: TenantId, input: CreateChannelOrderInput): ChannelOrder {
    assertPositiveMoney(input.netValue, "netValue");
    if (!input.salesOrderRef?.id?.trim()) {
      throw ValidationError.single("salesOrderRef.id", "a sales order reference is required");
    }
    if (input.listValue) {
      if (input.listValue.currency !== input.netValue.currency) {
        throw ValidationError.single("listValue", `must be in ${input.netValue.currency}`);
      }
      if (input.listValue.amountMinor < input.netValue.amountMinor) {
        throw ValidationError.single("listValue", "cannot be below the net value");
      }
    }
    const sourceType = input.sourceType ?? "partner_sourced";
    if (!ORDER_SOURCE_TYPES.includes(sourceType)) {
      throw ValidationError.single("sourceType", `must be one of [${ORDER_SOURCE_TYPES.join(", ")}]`);
    }

    const order = new ChannelOrder(tenantId, {
      number: input.number,
      partnerId: input.partnerId,
      registrationId: input.registrationId,
      channelQuoteId: input.channelQuoteId,
      customerKey: input.customerKey,
      customerName: input.customerName.trim(),
      salesOrderRef: {
        system: input.salesOrderRef.system?.trim() || "sales-erp",
        id: input.salesOrderRef.id.trim(),
        number: input.salesOrderRef.number?.trim(),
      },
      netValue: input.netValue,
      listValue: input.listValue,
      sourceType,
      status: "placed",
      orderedAt: assertIso(input.orderedAt, "orderedAt"),
      poNumber: input.poNumber?.trim() || undefined,
      partnerMarginBps: input.listValue ? discountBpsOf(input.listValue, input.netValue) : undefined,
    });
    order.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelOrderPlaced,
        aggregateType: "ChannelOrder",
        aggregateId: order.id,
        tenantId,
        payload: order.payload(),
      }),
    );
    return order;
  }

  static fromSnapshot(snapshot: EntityProps & ChannelOrderProps): ChannelOrder {
    const { id, tenantId, createdAt, updatedAt, version, ...props } = snapshot;
    return new ChannelOrder(tenantId, { ...props }, { id, createdAt, updatedAt, version });
  }

  get number(): string {
    return this.props.number;
  }
  get partnerId(): Ulid {
    return this.props.partnerId;
  }
  get registrationId(): Ulid | undefined {
    return this.props.registrationId;
  }
  get channelQuoteId(): Ulid | undefined {
    return this.props.channelQuoteId;
  }
  get customerKey(): CustomerKey {
    return this.props.customerKey;
  }
  get status(): ChannelOrderStatus {
    return this.props.status;
  }
  get netValue(): Money {
    return this.props.netValue;
  }
  get listValue(): Money | undefined {
    return this.props.listValue;
  }
  get sourceType(): OrderSourceType {
    return this.props.sourceType;
  }
  get orderedAt(): IsoDateTime {
    return this.props.orderedAt;
  }
  get salesOrderRef(): ExternalRef {
    return this.props.salesOrderRef;
  }
  get partnerMarginBps(): number | undefined {
    return this.props.partnerMarginBps;
  }

  /** Value that counts toward attainment; a cancelled order counts for nothing. */
  bookedValue(): Money {
    return this.props.status === "cancelled" ? zeroMoney(this.props.netValue.currency) : this.props.netValue;
  }

  invoice(input: { by: UserId; at: IsoDateTime; invoiceRef?: ExternalRef }): void {
    if (this.props.status !== "placed") {
      throw new InvalidStateError(
        `Order ${this.props.number} is ${this.props.status}; only a placed order can be invoiced`,
      );
    }
    this.props.status = "invoiced";
    this.props.invoicedAt = assertIso(input.at, "at");
    this.props.invoiceRef = input.invoiceRef
      ? { system: input.invoiceRef.system?.trim() || "finance-erp", id: input.invoiceRef.id.trim(), number: input.invoiceRef.number?.trim() }
      : undefined;
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelOrderInvoiced,
        aggregateType: "ChannelOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.payload(), invoiceRef: this.props.invoiceRef?.id },
      }),
    );
  }

  fulfill(input: { by: UserId; at: IsoDateTime }): void {
    if (this.props.status !== "invoiced" && this.props.status !== "placed") {
      throw new InvalidStateError(`Order ${this.props.number} is ${this.props.status}; it cannot be fulfilled`);
    }
    this.props.status = "fulfilled";
    this.props.fulfilledAt = assertIso(input.at, "at");
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelOrderFulfilled,
        aggregateType: "ChannelOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: this.payload(),
      }),
    );
  }

  cancel(input: { by: UserId; at: IsoDateTime; reason: string }): void {
    if (this.props.status === "fulfilled") {
      throw new InvalidStateError(`Order ${this.props.number} is fulfilled; raise a return instead of cancelling`);
    }
    if (this.props.status === "cancelled") return;
    if (input.reason.trim().length === 0) {
      throw ValidationError.single("reason", "a cancellation reason is required");
    }
    this.props.status = "cancelled";
    this.props.cancelledAt = assertIso(input.at, "at");
    this.props.cancelledReason = input.reason.trim();
    this.raise(
      envelope({
        eventType: ChannelEventTypes.ChannelOrderCancelled,
        aggregateType: "ChannelOrder",
        aggregateId: this.id,
        tenantId: this.tenantId,
        payload: { ...this.payload(), reason: input.reason.trim() },
      }),
    );
  }

  private payload() {
    return {
      orderId: this.id,
      number: this.props.number,
      partnerId: this.props.partnerId,
      registrationId: this.props.registrationId,
      channelQuoteId: this.props.channelQuoteId,
      salesOrderRef: this.props.salesOrderRef.id,
      netValue: this.props.netValue,
      sourceType: this.props.sourceType,
      orderedAt: this.props.orderedAt,
    };
  }
}

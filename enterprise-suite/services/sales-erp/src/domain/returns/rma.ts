import {
  ConflictError,
  assertTransition,
  newId,
  type CurrencyCode,
  type Money,
  type Sku,
  type StateMachineDef,
  type TenantId,
  type Ulid,
  currency,
  money,
} from "../../kernel/index.js";
import { AggregateRoot } from "../../kernel/aggregate.js";
import { RmaEventTypes, rmaEvent } from "./events.js";

export type RmaStatus = "requested" | "approved" | "rejected" | "received" | "refunded" | "cancelled";

export const RMA_STATUS_MACHINE: StateMachineDef<RmaStatus> = {
  name: "ReturnAuthorization",
  initial: "requested",
  transitions: {
    requested: ["approved", "rejected", "cancelled"],
    approved: ["received", "cancelled"],
    received: ["refunded"],
    refunded: [],
    rejected: [],
    cancelled: [],
  },
};

export type ReturnReason = "damaged" | "wrong_item" | "not_as_described" | "no_longer_needed" | "other";

/**
 * RMA line referencing an order line. Refund amount is captured at request
 * time from the order's effective (discounted) unit price so later order
 * edits cannot change what is owed.
 */
export interface RmaLine {
  readonly lineId: Ulid;
  readonly orderLineId: Ulid;
  readonly sku: Sku;
  readonly qty: number;
  readonly reason: ReturnReason;
  readonly unitRefund: Money;
}

export interface RmaProps {
  rmaNumber: string;
  orderId: Ulid;
  orderNumber: string;
  accountId: Ulid;
  currency: CurrencyCode;
  status: RmaStatus;
  lines: RmaLine[];
  rejectionReason?: string;
  notes?: string;
}

export class ReturnAuthorization extends AggregateRoot<RmaProps> {
  private constructor(tenantId: TenantId, props: RmaProps) {
    super(tenantId, props);
  }

  static request(
    tenantId: TenantId,
    input: {
      rmaNumber: string;
      orderId: Ulid;
      orderNumber: string;
      accountId: Ulid;
      currency: string;
      lines: readonly {
        orderLineId: Ulid;
        sku: Sku;
        qty: number;
        reason: ReturnReason;
        unitRefundMinor: number;
      }[];
      notes?: string;
    },
  ): ReturnAuthorization {
    if (input.lines.length === 0) {
      throw new ConflictError("A return needs at least one line");
    }
    const lines: RmaLine[] = input.lines.map((l) => {
      if (!Number.isInteger(l.qty) || l.qty < 1) {
        throw new ConflictError(`Return qty must be a positive integer (got ${l.qty})`);
      }
      return {
        lineId: newId("rline"),
        orderLineId: l.orderLineId,
        sku: l.sku,
        qty: l.qty,
        reason: l.reason,
        unitRefund: money(l.unitRefundMinor, input.currency),
      };
    });
    const rma = new ReturnAuthorization(tenantId, {
      rmaNumber: input.rmaNumber,
      orderId: input.orderId,
      orderNumber: input.orderNumber,
      accountId: input.accountId,
      currency: currency(input.currency),
      status: RMA_STATUS_MACHINE.initial,
      lines,
      notes: input.notes,
    });
    rma.raise(rmaEvent(RmaEventTypes.RmaRequested, rma.id, tenantId, rma.lifecyclePayload()));
    return rma;
  }

  get rmaNumber(): string {
    return this.props.rmaNumber;
  }

  get orderId(): Ulid {
    return this.props.orderId;
  }

  get status(): RmaStatus {
    return this.props.status;
  }

  get lines(): readonly RmaLine[] {
    return this.props.lines;
  }

  get refundTotal(): Money {
    const totalMinor = this.props.lines.reduce(
      (acc, l) => acc + (l.unitRefund.amountMinor as unknown as number) * l.qty,
      0,
    );
    return money(totalMinor, this.props.currency);
  }

  approve(): void {
    assertTransition(RMA_STATUS_MACHINE, this.props.status, "approved");
    this.props.status = "approved";
    this.raise(rmaEvent(RmaEventTypes.RmaApproved, this.id, this.tenantId, this.lifecyclePayload()));
  }

  reject(reason: string): void {
    assertTransition(RMA_STATUS_MACHINE, this.props.status, "rejected");
    if (!reason.trim()) throw new ConflictError("A rejection reason is required");
    this.props.status = "rejected";
    this.props.rejectionReason = reason.trim();
    this.raise(
      rmaEvent(RmaEventTypes.RmaRejected, this.id, this.tenantId, {
        ...this.lifecyclePayload(),
        reason: this.props.rejectionReason,
      }),
    );
  }

  markReceived(): void {
    assertTransition(RMA_STATUS_MACHINE, this.props.status, "received");
    this.props.status = "received";
    this.raise(rmaEvent(RmaEventTypes.RmaReceived, this.id, this.tenantId, this.lifecyclePayload()));
  }

  refund(): Money {
    assertTransition(RMA_STATUS_MACHINE, this.props.status, "refunded");
    this.props.status = "refunded";
    const total = this.refundTotal;
    this.raise(
      rmaEvent(RmaEventTypes.RmaRefunded, this.id, this.tenantId, {
        ...this.lifecyclePayload(),
        refundMinor: total.amountMinor as unknown as number,
        currency: this.props.currency as unknown as string,
      }),
    );
    return total;
  }

  cancel(): void {
    assertTransition(RMA_STATUS_MACHINE, this.props.status, "cancelled");
    this.props.status = "cancelled";
    this.raise(rmaEvent(RmaEventTypes.RmaCancelled, this.id, this.tenantId, this.lifecyclePayload()));
  }

  private lifecyclePayload(): { rmaNumber: string; orderId: string; orderNumber: string } {
    return {
      rmaNumber: this.props.rmaNumber,
      orderId: this.props.orderId as unknown as string,
      orderNumber: this.props.orderNumber,
    };
  }
}

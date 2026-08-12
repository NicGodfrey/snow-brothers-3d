import {
  AggregateRoot,
  envelope,
  err,
  ok,
  type CurrencyCode,
  type Result,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import {
  isIsoDate,
  newArPaymentId,
  type ArInvoiceId,
  type ArPaymentId,
  type IsoDate,
  type JournalId,
} from "./ids.js";
import { FinanceEventTypes } from "./events.js";

export type PaymentMethod = "BANK_TRANSFER" | "CARD" | "CASH" | "CHECK" | "OTHER";
export type ArPaymentStatus = "RECEIVED" | "PARTIALLY_APPLIED" | "APPLIED";

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  "BANK_TRANSFER",
  "CARD",
  "CASH",
  "CHECK",
  "OTHER",
];

export interface PaymentApplication {
  readonly invoiceId: ArInvoiceId;
  readonly amountMinor: number;
}

export interface ArPaymentProps {
  paymentNo: string;
  customerId: string;
  currency: CurrencyCode;
  amountMinor: number;
  receivedDate: IsoDate;
  method: PaymentMethod;
  reference?: string;
  applications: PaymentApplication[];
  status: ArPaymentStatus;
  journalId?: JournalId;
}

export class ArPayment extends AggregateRoot<ArPaymentProps> {
  private constructor(tenantId: TenantId, props: ArPaymentProps, id?: ArPaymentId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static receive(tenantId: TenantId, input: {
    paymentNo: string;
    customerId: string;
    currency: CurrencyCode;
    amountMinor: number;
    receivedDate: string;
    method: PaymentMethod;
    reference?: string;
  }): Result<ArPayment> {
    if (input.customerId.trim().length === 0) return err("customerId is required");
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return err("payment amount must be a positive integer in minor units");
    }
    if (!isIsoDate(input.receivedDate)) return err("receivedDate must be an ISO date");
    if (!PAYMENT_METHODS.includes(input.method)) return err(`unknown payment method "${input.method}"`);

    const payment = new ArPayment(tenantId, {
      paymentNo: input.paymentNo,
      customerId: input.customerId.trim(),
      currency: input.currency,
      amountMinor: input.amountMinor,
      receivedDate: input.receivedDate,
      method: input.method,
      reference: input.reference,
      applications: [],
      status: "RECEIVED",
    }, newArPaymentId());
    payment.raise(envelope({
      eventType: FinanceEventTypes.ArPaymentReceived,
      aggregateType: "ArPayment",
      aggregateId: payment.id,
      tenantId,
      payload: {
        paymentId: payment.id,
        paymentNo: input.paymentNo,
        customerId: payment.props.customerId,
        currency: input.currency,
        amountMinor: input.amountMinor,
      },
    }));
    return ok(payment);
  }

  get paymentNo(): string { return this.props.paymentNo; }
  get customerId(): string { return this.props.customerId; }
  get currency(): CurrencyCode { return this.props.currency; }
  get amountMinor(): number { return this.props.amountMinor; }
  get receivedDate(): IsoDate { return this.props.receivedDate; }
  get method(): PaymentMethod { return this.props.method; }
  get status(): ArPaymentStatus { return this.props.status; }
  get applications(): readonly PaymentApplication[] { return this.props.applications; }
  get journalId(): JournalId | undefined { return this.props.journalId; }

  appliedMinor(): number {
    return this.props.applications.reduce((s, a) => s + a.amountMinor, 0);
  }

  unappliedMinor(): number {
    return this.props.amountMinor - this.appliedMinor();
  }

  apply(invoiceId: ArInvoiceId, amountMinor: number): Result<void> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return err("application amount must be a positive integer");
    }
    if (amountMinor > this.unappliedMinor()) {
      return err(
        `application ${amountMinor} exceeds unapplied funds ${this.unappliedMinor()} on ${this.props.paymentNo}`,
      );
    }
    const applications = [...this.props.applications, { invoiceId, amountMinor }];
    const applied = applications.reduce((s, a) => s + a.amountMinor, 0);
    const status: ArPaymentStatus = applied === this.props.amountMinor ? "APPLIED" : "PARTIALLY_APPLIED";
    this.props = { ...this.props, applications, status };
    this.touch();
    return ok(undefined);
  }

  linkJournal(journalId: JournalId): void {
    this.props = { ...this.props, journalId };
    this.touch();
  }
}

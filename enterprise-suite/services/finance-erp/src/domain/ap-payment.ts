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
  newApPaymentId,
  type ApBillId,
  type ApPaymentId,
  type IsoDate,
  type JournalId,
} from "./ids.js";
import { PAYMENT_METHODS, type PaymentMethod } from "./ar-payment.js";
import { FinanceEventTypes } from "./events.js";

export type ApPaymentStatus = "ISSUED" | "PARTIALLY_APPLIED" | "APPLIED";

export interface BillApplication {
  readonly billId: ApBillId;
  readonly amountMinor: number;
}

export interface ApPaymentProps {
  paymentNo: string;
  supplierId: string;
  currency: CurrencyCode;
  amountMinor: number;
  paymentDate: IsoDate;
  method: PaymentMethod;
  reference?: string;
  applications: BillApplication[];
  status: ApPaymentStatus;
  journalId?: JournalId;
}

export class ApPayment extends AggregateRoot<ApPaymentProps> {
  private constructor(tenantId: TenantId, props: ApPaymentProps, id?: ApPaymentId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static issue(tenantId: TenantId, input: {
    paymentNo: string;
    supplierId: string;
    currency: CurrencyCode;
    amountMinor: number;
    paymentDate: string;
    method: PaymentMethod;
    reference?: string;
  }): Result<ApPayment> {
    if (input.supplierId.trim().length === 0) return err("supplierId is required");
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      return err("payment amount must be a positive integer in minor units");
    }
    if (!isIsoDate(input.paymentDate)) return err("paymentDate must be an ISO date");
    if (!PAYMENT_METHODS.includes(input.method)) return err(`unknown payment method "${input.method}"`);

    const payment = new ApPayment(tenantId, {
      paymentNo: input.paymentNo,
      supplierId: input.supplierId.trim(),
      currency: input.currency,
      amountMinor: input.amountMinor,
      paymentDate: input.paymentDate,
      method: input.method,
      reference: input.reference,
      applications: [],
      status: "ISSUED",
    }, newApPaymentId());
    payment.raise(envelope({
      eventType: FinanceEventTypes.ApPaymentIssued,
      aggregateType: "ApPayment",
      aggregateId: payment.id,
      tenantId,
      payload: {
        paymentId: payment.id,
        paymentNo: input.paymentNo,
        supplierId: payment.props.supplierId,
        currency: input.currency,
        amountMinor: input.amountMinor,
      },
    }));
    return ok(payment);
  }

  get paymentNo(): string { return this.props.paymentNo; }
  get supplierId(): string { return this.props.supplierId; }
  get currency(): CurrencyCode { return this.props.currency; }
  get amountMinor(): number { return this.props.amountMinor; }
  get paymentDate(): IsoDate { return this.props.paymentDate; }
  get method(): PaymentMethod { return this.props.method; }
  get status(): ApPaymentStatus { return this.props.status; }
  get applications(): readonly BillApplication[] { return this.props.applications; }
  get journalId(): JournalId | undefined { return this.props.journalId; }

  appliedMinor(): number {
    return this.props.applications.reduce((s, a) => s + a.amountMinor, 0);
  }

  unappliedMinor(): number {
    return this.props.amountMinor - this.appliedMinor();
  }

  apply(billId: ApBillId, amountMinor: number): Result<void> {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      return err("application amount must be a positive integer");
    }
    if (amountMinor > this.unappliedMinor()) {
      return err(
        `application ${amountMinor} exceeds unapplied funds ${this.unappliedMinor()} on ${this.props.paymentNo}`,
      );
    }
    const applications = [...this.props.applications, { billId, amountMinor }];
    const applied = applications.reduce((s, a) => s + a.amountMinor, 0);
    const status: ApPaymentStatus = applied === this.props.amountMinor ? "APPLIED" : "PARTIALLY_APPLIED";
    this.props = { ...this.props, applications, status };
    this.touch();
    return ok(undefined);
  }

  linkJournal(journalId: JournalId): void {
    this.props = { ...this.props, journalId };
    this.touch();
  }
}

import { AggregateRoot, envelope, err, ok, } from "@enterprise-suite/shared-kernel";
import { isIsoDate, newArPaymentId, } from "./ids.js";
import { FinanceEventTypes } from "./events.js";
export const PAYMENT_METHODS = [
    "BANK_TRANSFER",
    "CARD",
    "CASH",
    "CHECK",
    "OTHER",
];
export class ArPayment extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static receive(tenantId, input) {
        if (input.customerId.trim().length === 0)
            return err("customerId is required");
        if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
            return err("payment amount must be a positive integer in minor units");
        }
        if (!isIsoDate(input.receivedDate))
            return err("receivedDate must be an ISO date");
        if (!PAYMENT_METHODS.includes(input.method))
            return err(`unknown payment method "${input.method}"`);
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
    get paymentNo() { return this.props.paymentNo; }
    get customerId() { return this.props.customerId; }
    get currency() { return this.props.currency; }
    get amountMinor() { return this.props.amountMinor; }
    get receivedDate() { return this.props.receivedDate; }
    get method() { return this.props.method; }
    get status() { return this.props.status; }
    get applications() { return this.props.applications; }
    get journalId() { return this.props.journalId; }
    appliedMinor() {
        return this.props.applications.reduce((s, a) => s + a.amountMinor, 0);
    }
    unappliedMinor() {
        return this.props.amountMinor - this.appliedMinor();
    }
    apply(invoiceId, amountMinor) {
        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            return err("application amount must be a positive integer");
        }
        if (amountMinor > this.unappliedMinor()) {
            return err(`application ${amountMinor} exceeds unapplied funds ${this.unappliedMinor()} on ${this.props.paymentNo}`);
        }
        const applications = [...this.props.applications, { invoiceId, amountMinor }];
        const applied = applications.reduce((s, a) => s + a.amountMinor, 0);
        const status = applied === this.props.amountMinor ? "APPLIED" : "PARTIALLY_APPLIED";
        this.props = { ...this.props, applications, status };
        this.touch();
        return ok(undefined);
    }
    linkJournal(journalId) {
        this.props = { ...this.props, journalId };
        this.touch();
    }
}
//# sourceMappingURL=ar-payment.js.map
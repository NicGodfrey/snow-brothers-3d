import { AggregateRoot, envelope, err, ok, } from "@enterprise-suite/shared-kernel";
import { isIsoDate, newApPaymentId, } from "./ids.js";
import { PAYMENT_METHODS } from "./ar-payment.js";
import { FinanceEventTypes } from "./events.js";
export class ApPayment extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static issue(tenantId, input) {
        if (input.supplierId.trim().length === 0)
            return err("supplierId is required");
        if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
            return err("payment amount must be a positive integer in minor units");
        }
        if (!isIsoDate(input.paymentDate))
            return err("paymentDate must be an ISO date");
        if (!PAYMENT_METHODS.includes(input.method))
            return err(`unknown payment method "${input.method}"`);
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
    get paymentNo() { return this.props.paymentNo; }
    get supplierId() { return this.props.supplierId; }
    get currency() { return this.props.currency; }
    get amountMinor() { return this.props.amountMinor; }
    get paymentDate() { return this.props.paymentDate; }
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
    apply(billId, amountMinor) {
        if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
            return err("application amount must be a positive integer");
        }
        if (amountMinor > this.unappliedMinor()) {
            return err(`application ${amountMinor} exceeds unapplied funds ${this.unappliedMinor()} on ${this.props.paymentNo}`);
        }
        const applications = [...this.props.applications, { billId, amountMinor }];
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
//# sourceMappingURL=ap-payment.js.map
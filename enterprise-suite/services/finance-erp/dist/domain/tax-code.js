import { AggregateRoot, envelope, err, ok, } from "@enterprise-suite/shared-kernel";
import { newTaxCodeId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";
const TAX_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,14}$/;
export class TaxCode extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static create(tenantId, input) {
        const code = input.code.trim().toUpperCase();
        if (!TAX_CODE_RE.test(code)) {
            return err(`tax code "${input.code}" must be 2-15 chars of A-Z, 0-9, dash`);
        }
        if (input.name.trim().length === 0)
            return err("tax code name is required");
        if (!Number.isInteger(input.rateBps) || input.rateBps < 0 || input.rateBps > 10_000) {
            return err(`rateBps must be an integer 0-10000, got ${input.rateBps}`);
        }
        const tax = new TaxCode(tenantId, {
            code,
            name: input.name.trim(),
            rateBps: input.rateBps,
            scope: input.scope ?? "BOTH",
            active: true,
        }, newTaxCodeId());
        tax.raise(envelope({
            eventType: FinanceEventTypes.TaxCodeCreated,
            aggregateType: "TaxCode",
            aggregateId: tax.id,
            tenantId,
            payload: { taxCodeId: tax.id, code, rateBps: input.rateBps },
        }));
        return ok(tax);
    }
    get code() { return this.props.code; }
    get name() { return this.props.name; }
    get rateBps() { return this.props.rateBps; }
    get scope() { return this.props.scope; }
    get active() { return this.props.active; }
    appliesTo(side) {
        return this.props.active && (this.props.scope === "BOTH" || this.props.scope === side);
    }
    deactivate() {
        if (!this.props.active)
            return err(`tax code ${this.props.code} is already inactive`);
        this.props = { ...this.props, active: false };
        this.touch();
        return ok(undefined);
    }
}
//# sourceMappingURL=tax-code.js.map
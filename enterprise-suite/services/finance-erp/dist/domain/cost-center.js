import { AggregateRoot, envelope, err, ok, } from "@enterprise-suite/shared-kernel";
import { newCostCenterId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";
const COST_CENTER_CODE_RE = /^[A-Z0-9][A-Z0-9-]{1,19}$/;
export class CostCenter extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static create(tenantId, input) {
        const code = input.code.trim().toUpperCase();
        if (!COST_CENTER_CODE_RE.test(code)) {
            return err(`cost center code "${input.code}" must be 2-20 chars of A-Z, 0-9, dash`);
        }
        if (input.name.trim().length === 0)
            return err("cost center name is required");
        const cc = new CostCenter(tenantId, {
            code,
            name: input.name.trim(),
            parentCode: input.parentCode?.trim().toUpperCase(),
            managerUserId: input.managerUserId,
            active: true,
        }, newCostCenterId());
        cc.raise(envelope({
            eventType: FinanceEventTypes.CostCenterCreated,
            aggregateType: "CostCenter",
            aggregateId: cc.id,
            tenantId,
            payload: { costCenterId: cc.id, code },
        }));
        return ok(cc);
    }
    get code() { return this.props.code; }
    get name() { return this.props.name; }
    get parentCode() { return this.props.parentCode; }
    get active() { return this.props.active; }
    deactivate() {
        if (!this.props.active)
            return err(`cost center ${this.props.code} is already inactive`);
        this.props = { ...this.props, active: false };
        this.touch();
        return ok(undefined);
    }
}
//# sourceMappingURL=cost-center.js.map
import { AggregateRoot, envelope, err, ok, } from "@enterprise-suite/shared-kernel";
import { newAccountId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";
export const ACCOUNT_TYPES = [
    "ASSET",
    "LIABILITY",
    "EQUITY",
    "REVENUE",
    "EXPENSE",
];
export function normalBalanceOf(type) {
    return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}
const ACCOUNT_CODE_RE = /^[0-9]{3,10}(\.[0-9]{1,4})?$/;
export class Account extends AggregateRoot {
    constructor(tenantId, props, id) {
        super(tenantId, props, id ? { id } : undefined);
    }
    static create(tenantId, input) {
        if (!ACCOUNT_CODE_RE.test(input.code)) {
            return err(`account code "${input.code}" must be numeric (3-10 digits, optional .suffix)`);
        }
        if (input.name.trim().length === 0)
            return err("account name is required");
        if (!ACCOUNT_TYPES.includes(input.type))
            return err(`unknown account type "${input.type}"`);
        const account = new Account(tenantId, {
            code: input.code,
            name: input.name.trim(),
            type: input.type,
            normalBalance: normalBalanceOf(input.type),
            currency: input.currency,
            postable: input.postable ?? true,
            parentCode: input.parentCode,
            description: input.description,
            active: true,
        }, newAccountId());
        account.raise(envelope({
            eventType: FinanceEventTypes.AccountCreated,
            aggregateType: "Account",
            aggregateId: account.id,
            tenantId,
            payload: { accountId: account.id, code: input.code, type: input.type },
        }));
        return ok(account);
    }
    get code() { return this.props.code; }
    get name() { return this.props.name; }
    get type() { return this.props.type; }
    get normalBalance() { return this.props.normalBalance; }
    get currency() { return this.props.currency; }
    get postable() { return this.props.postable; }
    get active() { return this.props.active; }
    get parentCode() { return this.props.parentCode; }
    rename(name) {
        if (name.trim().length === 0)
            return err("account name is required");
        this.props = { ...this.props, name: name.trim() };
        this.touch();
        return ok(undefined);
    }
    deactivate() {
        if (!this.props.active)
            return err(`account ${this.props.code} is already inactive`);
        this.props = { ...this.props, active: false };
        this.raise(envelope({
            eventType: FinanceEventTypes.AccountDeactivated,
            aggregateType: "Account",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { accountId: this.id, code: this.props.code },
        }));
        return ok(undefined);
    }
    reactivate() {
        if (this.props.active)
            return err(`account ${this.props.code} is already active`);
        this.props = { ...this.props, active: true };
        this.touch();
        return ok(undefined);
    }
    /** True when the account can receive a journal line right now. */
    acceptsPostings() {
        return this.props.active && this.props.postable;
    }
}
//# sourceMappingURL=account.js.map
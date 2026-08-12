import { ConflictError, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { Account } from "../domain/account.js";
import { expectOk } from "./service-support.js";
export class AccountService {
    accounts;
    outbox;
    constructor(accounts, outbox) {
        this.accounts = accounts;
        this.outbox = outbox;
    }
    async createAccount(ctx, command) {
        const existing = await this.accounts.findByCode(ctx.tenantId, command.code);
        if (existing) {
            throw new ConflictError(`account code ${command.code} already exists`);
        }
        if (command.parentCode) {
            const parent = await this.accounts.findByCode(ctx.tenantId, command.parentCode);
            if (!parent)
                throw new NotFoundError("Account (parent)", command.parentCode);
            if (parent.postable) {
                throw new ConflictError(`parent account ${command.parentCode} is postable; only summary accounts can have children`);
            }
        }
        const input = {
            code: command.code,
            name: command.name,
            type: command.type,
            currency: command.currency.toUpperCase(),
            postable: command.postable,
            parentCode: command.parentCode,
            description: command.description,
        };
        const account = expectOk(Account.create(ctx.tenantId, input));
        await this.accounts.save(account);
        this.outbox.publishAll(account.pullEvents());
        return account;
    }
    async getAccount(ctx, id) {
        const account = await this.accounts.findById(ctx.tenantId, id);
        if (!account)
            throw new NotFoundError("Account", id);
        return account;
    }
    async getAccountByCode(ctx, code) {
        const account = await this.accounts.findByCode(ctx.tenantId, code);
        if (!account)
            throw new NotFoundError("Account", code);
        return account;
    }
    async listAccounts(ctx) {
        return this.accounts.list(ctx.tenantId);
    }
    async deactivateAccount(ctx, id) {
        const account = await this.getAccount(ctx, id);
        expectOk(account.deactivate());
        await this.accounts.save(account);
        this.outbox.publishAll(account.pullEvents());
        return account;
    }
    async reactivateAccount(ctx, id) {
        const account = await this.getAccount(ctx, id);
        expectOk(account.reactivate());
        await this.accounts.save(account);
        return account;
    }
}
//# sourceMappingURL=account-service.js.map
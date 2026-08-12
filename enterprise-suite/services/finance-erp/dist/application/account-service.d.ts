import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { Account, type AccountType } from "../domain/account.js";
import type { AccountId } from "../domain/ids.js";
import type { AccountRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
export interface CreateAccountCommand {
    code: string;
    name: string;
    type: AccountType;
    currency: string;
    postable?: boolean;
    parentCode?: string;
    description?: string;
}
export declare class AccountService {
    private readonly accounts;
    private readonly outbox;
    constructor(accounts: AccountRepository, outbox: EventOutbox);
    createAccount(ctx: TenantContext, command: CreateAccountCommand): Promise<Account>;
    getAccount(ctx: TenantContext, id: AccountId): Promise<Account>;
    getAccountByCode(ctx: TenantContext, code: string): Promise<Account>;
    listAccounts(ctx: TenantContext): Promise<Account[]>;
    deactivateAccount(ctx: TenantContext, id: AccountId): Promise<Account>;
    reactivateAccount(ctx: TenantContext, id: AccountId): Promise<Account>;
}
//# sourceMappingURL=account-service.d.ts.map
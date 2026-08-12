import {
  ConflictError,
  NotFoundError,
  type CurrencyCode,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { Account, type AccountType, type CreateAccountInput } from "../domain/account.js";
import type { AccountId } from "../domain/ids.js";
import type { AccountRepository } from "../infrastructure/repositories.js";
import type { EventOutbox } from "../infrastructure/outbox.js";
import { expectOk } from "./service-support.js";

export interface CreateAccountCommand {
  code: string;
  name: string;
  type: AccountType;
  currency: string;
  postable?: boolean;
  parentCode?: string;
  description?: string;
}

export class AccountService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly outbox: EventOutbox,
  ) {}

  async createAccount(ctx: TenantContext, command: CreateAccountCommand): Promise<Account> {
    const existing = await this.accounts.findByCode(ctx.tenantId, command.code);
    if (existing) {
      throw new ConflictError(`account code ${command.code} already exists`);
    }
    if (command.parentCode) {
      const parent = await this.accounts.findByCode(ctx.tenantId, command.parentCode);
      if (!parent) throw new NotFoundError("Account (parent)", command.parentCode);
      if (parent.postable) {
        throw new ConflictError(
          `parent account ${command.parentCode} is postable; only summary accounts can have children`,
        );
      }
    }
    const input: CreateAccountInput = {
      code: command.code,
      name: command.name,
      type: command.type,
      currency: command.currency.toUpperCase() as CurrencyCode,
      postable: command.postable,
      parentCode: command.parentCode,
      description: command.description,
    };
    const account = expectOk(Account.create(ctx.tenantId, input));
    await this.accounts.save(account);
    this.outbox.publishAll(account.pullEvents());
    return account;
  }

  async getAccount(ctx: TenantContext, id: AccountId): Promise<Account> {
    const account = await this.accounts.findById(ctx.tenantId, id);
    if (!account) throw new NotFoundError("Account", id);
    return account;
  }

  async getAccountByCode(ctx: TenantContext, code: string): Promise<Account> {
    const account = await this.accounts.findByCode(ctx.tenantId, code);
    if (!account) throw new NotFoundError("Account", code);
    return account;
  }

  async listAccounts(ctx: TenantContext): Promise<Account[]> {
    return this.accounts.list(ctx.tenantId);
  }

  async deactivateAccount(ctx: TenantContext, id: AccountId): Promise<Account> {
    const account = await this.getAccount(ctx, id);
    expectOk(account.deactivate());
    await this.accounts.save(account);
    this.outbox.publishAll(account.pullEvents());
    return account;
  }

  async reactivateAccount(ctx: TenantContext, id: AccountId): Promise<Account> {
    const account = await this.getAccount(ctx, id);
    expectOk(account.reactivate());
    await this.accounts.save(account);
    return account;
  }
}

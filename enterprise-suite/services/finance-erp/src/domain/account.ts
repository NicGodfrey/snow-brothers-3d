import {
  AggregateRoot,
  envelope,
  err,
  ok,
  type CurrencyCode,
  type Result,
  type TenantId,
} from "@enterprise-suite/shared-kernel";
import { newAccountId, type AccountId } from "./ids.js";
import { FinanceEventTypes } from "./events.js";

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type NormalBalance = "DEBIT" | "CREDIT";

export const ACCOUNT_TYPES: readonly AccountType[] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
];

export function normalBalanceOf(type: AccountType): NormalBalance {
  return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}

export interface AccountProps {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: NormalBalance;
  currency: CurrencyCode;
  /** Summary accounts group postable children; only postable accounts accept journal lines. */
  postable: boolean;
  parentCode?: string;
  description?: string;
  active: boolean;
}

export interface CreateAccountInput {
  code: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  postable?: boolean;
  parentCode?: string;
  description?: string;
}

const ACCOUNT_CODE_RE = /^[0-9]{3,10}(\.[0-9]{1,4})?$/;

export class Account extends AggregateRoot<AccountProps> {
  private constructor(tenantId: TenantId, props: AccountProps, id?: AccountId) {
    super(tenantId, props, id ? { id } : undefined);
  }

  static create(tenantId: TenantId, input: CreateAccountInput): Result<Account> {
    if (!ACCOUNT_CODE_RE.test(input.code)) {
      return err(`account code "${input.code}" must be numeric (3-10 digits, optional .suffix)`);
    }
    if (input.name.trim().length === 0) return err("account name is required");
    if (!ACCOUNT_TYPES.includes(input.type)) return err(`unknown account type "${input.type}"`);

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

  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get type(): AccountType { return this.props.type; }
  get normalBalance(): NormalBalance { return this.props.normalBalance; }
  get currency(): CurrencyCode { return this.props.currency; }
  get postable(): boolean { return this.props.postable; }
  get active(): boolean { return this.props.active; }
  get parentCode(): string | undefined { return this.props.parentCode; }

  rename(name: string): Result<void> {
    if (name.trim().length === 0) return err("account name is required");
    this.props = { ...this.props, name: name.trim() };
    this.touch();
    return ok(undefined);
  }

  deactivate(): Result<void> {
    if (!this.props.active) return err(`account ${this.props.code} is already inactive`);
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

  reactivate(): Result<void> {
    if (this.props.active) return err(`account ${this.props.code} is already active`);
    this.props = { ...this.props, active: true };
    this.touch();
    return ok(undefined);
  }

  /** True when the account can receive a journal line right now. */
  acceptsPostings(): boolean {
    return this.props.active && this.props.postable;
  }
}

import {
  ConflictError,
  assertTransition,
  type CurrencyCode,
  type Money,
  type StateMachineDef,
  type TenantId,
  type UserId,
  currency,
  money,
  moneyToJSON,
} from "../../kernel/index.js";
import { AggregateRoot } from "../../kernel/aggregate.js";
import type { Address } from "./address.js";
import { AccountEventTypes, accountEvent } from "./events.js";

export type AccountType = "prospect" | "customer" | "partner";
export type AccountStatus = "active" | "on_hold" | "closed";
export type PaymentTerms = "DUE_ON_RECEIPT" | "NET15" | "NET30" | "NET45" | "NET60";

export const ACCOUNT_STATUS_MACHINE: StateMachineDef<AccountStatus> = {
  name: "Account",
  initial: "active",
  transitions: {
    active: ["on_hold", "closed"],
    on_hold: ["active", "closed"],
    closed: [],
  },
};

export interface AccountProps {
  accountNumber: string;
  name: string;
  accountType: AccountType;
  status: AccountStatus;
  industry?: string;
  website?: string;
  currency: CurrencyCode;
  paymentTerms: PaymentTerms;
  /** null means "no limit configured": credit checks pass trivially. */
  creditLimit: Money | null;
  creditHold: boolean;
  creditHoldReason?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
  ownerId?: UserId;
}

export interface CreateAccountInput {
  accountNumber: string;
  name: string;
  accountType: AccountType;
  currency: string;
  paymentTerms?: PaymentTerms;
  industry?: string;
  website?: string;
  creditLimitMinor?: number | null;
  billingAddress?: Address;
  shippingAddress?: Address;
  ownerId?: UserId;
}

export class Account extends AggregateRoot<AccountProps> {
  private constructor(tenantId: TenantId, props: AccountProps) {
    super(tenantId, props);
  }

  static create(tenantId: TenantId, input: CreateAccountInput): Account {
    const props: AccountProps = {
      accountNumber: input.accountNumber,
      name: input.name.trim(),
      accountType: input.accountType,
      status: "active",
      industry: input.industry,
      website: input.website,
      currency: currency(input.currency),
      paymentTerms: input.paymentTerms ?? "NET30",
      creditLimit:
        input.creditLimitMinor === undefined || input.creditLimitMinor === null
          ? null
          : money(input.creditLimitMinor, input.currency),
      creditHold: false,
      billingAddress: input.billingAddress,
      shippingAddress: input.shippingAddress,
      ownerId: input.ownerId,
    };
    const account = new Account(tenantId, props);
    account.raise(
      accountEvent(AccountEventTypes.AccountCreated, account.id, tenantId, {
        accountNumber: props.accountNumber,
        name: props.name,
        accountType: props.accountType,
      }),
    );
    return account;
  }

  get accountNumber(): string {
    return this.props.accountNumber;
  }

  get name(): string {
    return this.props.name;
  }

  get accountType(): AccountType {
    return this.props.accountType;
  }

  get status(): AccountStatus {
    return this.props.status;
  }

  get currencyCode(): CurrencyCode {
    return this.props.currency;
  }

  get paymentTerms(): PaymentTerms {
    return this.props.paymentTerms;
  }

  get creditLimit(): Money | null {
    return this.props.creditLimit;
  }

  get creditHold(): boolean {
    return this.props.creditHold;
  }

  get shippingAddress(): Address | undefined {
    return this.props.shippingAddress;
  }

  updateDetails(patch: {
    name?: string;
    industry?: string;
    website?: string;
    paymentTerms?: PaymentTerms;
    billingAddress?: Address;
    shippingAddress?: Address;
    ownerId?: UserId;
  }): void {
    this.assertOpen("update");
    if (patch.name !== undefined) this.props.name = patch.name.trim();
    if (patch.industry !== undefined) this.props.industry = patch.industry;
    if (patch.website !== undefined) this.props.website = patch.website;
    if (patch.paymentTerms !== undefined) this.props.paymentTerms = patch.paymentTerms;
    if (patch.billingAddress !== undefined) this.props.billingAddress = patch.billingAddress;
    if (patch.shippingAddress !== undefined) this.props.shippingAddress = patch.shippingAddress;
    if (patch.ownerId !== undefined) this.props.ownerId = patch.ownerId;
    this.raise(
      accountEvent(AccountEventTypes.AccountUpdated, this.id, this.tenantId, {
        accountNumber: this.props.accountNumber,
      }),
    );
  }

  convertToCustomer(): void {
    this.assertOpen("convert");
    if (this.props.accountType === "customer") {
      throw new ConflictError(`Account ${this.props.accountNumber} is already a customer`);
    }
    const previousType = this.props.accountType;
    this.props.accountType = "customer";
    this.raise(
      accountEvent(AccountEventTypes.AccountConvertedToCustomer, this.id, this.tenantId, {
        accountNumber: this.props.accountNumber,
        previousType,
      }),
    );
  }

  changeCreditLimit(limitMinor: number | null): void {
    this.assertOpen("change credit limit of");
    if (limitMinor !== null && limitMinor < 0) {
      throw new ConflictError("Credit limit cannot be negative");
    }
    const previous = this.props.creditLimit;
    this.props.creditLimit = limitMinor === null ? null : money(limitMinor, this.props.currency);
    this.raise(
      accountEvent(AccountEventTypes.AccountCreditLimitChanged, this.id, this.tenantId, {
        accountNumber: this.props.accountNumber,
        previousLimitMinor: previous ? (previous.amountMinor as unknown as number) : null,
        newLimitMinor: limitMinor,
        currency: this.props.currency as unknown as string,
      }),
    );
  }

  placeCreditHold(reason: string): void {
    this.assertOpen("place credit hold on");
    if (this.props.creditHold) {
      throw new ConflictError(`Account ${this.props.accountNumber} is already on credit hold`);
    }
    assertTransition(ACCOUNT_STATUS_MACHINE, this.props.status, "on_hold");
    this.props.creditHold = true;
    this.props.creditHoldReason = reason;
    this.props.status = "on_hold";
    this.raise(
      accountEvent(AccountEventTypes.AccountCreditHoldPlaced, this.id, this.tenantId, {
        accountNumber: this.props.accountNumber,
        reason,
      }),
    );
  }

  releaseCreditHold(): void {
    if (!this.props.creditHold) {
      throw new ConflictError(`Account ${this.props.accountNumber} is not on credit hold`);
    }
    assertTransition(ACCOUNT_STATUS_MACHINE, this.props.status, "active");
    this.props.creditHold = false;
    this.props.creditHoldReason = undefined;
    this.props.status = "active";
    this.raise(
      accountEvent(AccountEventTypes.AccountCreditHoldReleased, this.id, this.tenantId, {
        accountNumber: this.props.accountNumber,
        reason: "released",
      }),
    );
  }

  close(): void {
    assertTransition(ACCOUNT_STATUS_MACHINE, this.props.status, "closed");
    this.props.status = "closed";
    this.raise(
      accountEvent(AccountEventTypes.AccountClosed, this.id, this.tenantId, {
        accountNumber: this.props.accountNumber,
      }),
    );
  }

  snapshot(): Record<string, unknown> {
    const json = this.toJSON() as unknown as Record<string, unknown>;
    return {
      ...json,
      creditLimit: this.props.creditLimit ? moneyToJSON(this.props.creditLimit) : null,
    };
  }

  private assertOpen(action: string): void {
    if (this.props.status === "closed") {
      throw new ConflictError(`Cannot ${action} closed account ${this.props.accountNumber}`);
    }
  }
}

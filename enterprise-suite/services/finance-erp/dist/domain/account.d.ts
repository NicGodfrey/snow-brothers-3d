import { AggregateRoot, type CurrencyCode, type Result, type TenantId } from "@enterprise-suite/shared-kernel";
export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE";
export type NormalBalance = "DEBIT" | "CREDIT";
export declare const ACCOUNT_TYPES: readonly AccountType[];
export declare function normalBalanceOf(type: AccountType): NormalBalance;
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
export declare class Account extends AggregateRoot<AccountProps> {
    private constructor();
    static create(tenantId: TenantId, input: CreateAccountInput): Result<Account>;
    get code(): string;
    get name(): string;
    get type(): AccountType;
    get normalBalance(): NormalBalance;
    get currency(): CurrencyCode;
    get postable(): boolean;
    get active(): boolean;
    get parentCode(): string | undefined;
    rename(name: string): Result<void>;
    deactivate(): Result<void>;
    reactivate(): Result<void>;
    /** True when the account can receive a journal line right now. */
    acceptsPostings(): boolean;
}
//# sourceMappingURL=account.d.ts.map
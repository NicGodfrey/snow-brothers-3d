import type { Brand } from "./branded.js";
export type CurrencyCode = Brand<string, "CurrencyCode">;
export type MoneyMinor = Brand<number, "MoneyMinor">;
export interface Money {
    readonly amountMinor: MoneyMinor;
    readonly currency: CurrencyCode;
}
export declare function money(amountMinor: number, currency: string): Money;
export declare function addMoney(a: Money, b: Money): Money;
export declare function mulMoney(a: Money, factor: number): Money;
//# sourceMappingURL=money.d.ts.map
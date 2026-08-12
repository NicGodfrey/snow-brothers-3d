export function money(amountMinor, currency) {
    if (!Number.isInteger(amountMinor)) {
        throw new Error("Money amount must be integer minor units");
    }
    return {
        amountMinor: amountMinor,
        currency: currency.toUpperCase(),
    };
}
export function addMoney(a, b) {
    if (a.currency !== b.currency)
        throw new Error("Currency mismatch");
    return money(a.amountMinor + b.amountMinor, a.currency);
}
export function mulMoney(a, factor) {
    return money(Math.round(a.amountMinor * factor), a.currency);
}
//# sourceMappingURL=money.js.map
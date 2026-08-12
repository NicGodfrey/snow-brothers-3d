import { AggregateRoot, DomainError, envelope, } from "@enterprise-suite/shared-kernel";
import { SupplyChainEvents } from "./events.js";
import { assertQty, roundQty } from "./types.js";
export function parseSafetyStockMethod(input) {
    if (typeof input !== "object" || input === null) {
        throw new DomainError("Safety stock method must be an object", "VALIDATION");
    }
    const raw = input;
    switch (raw.type) {
        case "STATIC":
            return { type: "STATIC", qty: assertQty("qty", raw.qty) };
        case "DAYS_OF_COVER": {
            const days = raw.days;
            if (typeof days !== "number" || !Number.isFinite(days) || days <= 0 || days > 365) {
                throw new DomainError("days must be a number in (0, 365]", "VALIDATION");
            }
            return { type: "DAYS_OF_COVER", days };
        }
        case "SERVICE_LEVEL": {
            const sl = raw.serviceLevel;
            if (typeof sl !== "number" || sl <= 0.5 || sl > 0.9999) {
                throw new DomainError("serviceLevel must be in (0.5, 0.9999]", "VALIDATION");
            }
            const stdDev = raw.weeklyDemandStdDev === undefined
                ? undefined
                : assertQty("weeklyDemandStdDev", raw.weeklyDemandStdDev);
            return { type: "SERVICE_LEVEL", serviceLevel: sl, weeklyDemandStdDev: stdDev };
        }
        default:
            throw new DomainError(`Unknown safety stock method: ${String(raw.type)}`, "VALIDATION");
    }
}
/**
 * Inverse standard normal CDF (probit) via Acklam's rational approximation.
 * Absolute error < 1.15e-9 over the open interval (0, 1) — more than enough
 * precision for service-level z-factors.
 */
export function inverseNormalCdf(p) {
    if (p <= 0 || p >= 1) {
        throw new DomainError("Probability must be in the open interval (0, 1)", "VALIDATION");
    }
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const pLow = 0.02425;
    if (p < pLow) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
            ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p <= 1 - pLow) {
        const q = p - 0.5;
        const r = q * q;
        return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
            (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
    }
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
        ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}
/** Sample standard deviation of a weekly demand series. */
export function weeklyStdDev(series) {
    if (series.length < 2)
        return 0;
    const mean = series.reduce((s, v) => s + v, 0) / series.length;
    const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / (series.length - 1);
    return Math.sqrt(variance);
}
export function computeSafetyStock(method, ctx) {
    switch (method.type) {
        case "STATIC":
            return method.qty;
        case "DAYS_OF_COVER":
            return roundQty((ctx.avgWeeklyDemand / 7) * method.days);
        case "SERVICE_LEVEL": {
            const sigma = method.weeklyDemandStdDev ?? ctx.weeklyDemandStdDev;
            if (sigma <= 0)
                return 0;
            const leadTimeWeeks = Math.max(ctx.leadTimeDays, 1) / 7;
            const z = inverseNormalCdf(method.serviceLevel);
            return roundQty(z * sigma * Math.sqrt(leadTimeWeeks));
        }
    }
}
/**
 * Named, reusable safety stock policy. Items reference a policy by id so a
 * planner can retune coverage for a whole segment (e.g. "A items 98% SL")
 * in one place.
 */
export class SafetyStockPolicy extends AggregateRoot {
    static create(tenantId, input) {
        const name = input.name?.trim();
        if (!name)
            throw new DomainError("Policy name is required", "VALIDATION");
        const policy = new SafetyStockPolicy(tenantId, {
            name,
            description: input.description?.trim() || null,
            method: input.method,
        });
        policy.raiseChanged();
        return policy;
    }
    get name() {
        return this.props.name;
    }
    get method() {
        return this.props.method;
    }
    changeMethod(method) {
        this.props = { ...this.props, method };
        this.raiseChanged();
    }
    rename(name) {
        const trimmed = name.trim();
        if (!trimmed)
            throw new DomainError("Policy name is required", "VALIDATION");
        this.props = { ...this.props, name: trimmed };
        this.touch();
    }
    compute(ctx) {
        return computeSafetyStock(this.props.method, ctx);
    }
    raiseChanged() {
        this.raise(envelope({
            eventType: SupplyChainEvents.SafetyStockPolicyChanged,
            aggregateType: "SafetyStockPolicy",
            aggregateId: this.id,
            tenantId: this.tenantId,
            payload: { policyId: this.id, name: this.props.name, method: this.props.method },
        }));
    }
}
//# sourceMappingURL=safety-stock.js.map
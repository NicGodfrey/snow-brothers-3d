import { DomainError } from "@enterprise-suite/shared-kernel";
import { asObject, optionalString, requireNumber, requireString } from "../validate.js";
export function registerSafetyStockRoutes(router, module) {
    router.post("/safety-stock-policies", async (req) => {
        const body = asObject(req.body);
        const policy = await module.safetyStock.createPolicy(req.ctx, {
            name: requireString(body, "name"),
            description: optionalString(body, "description"),
            method: asObject(body.method ?? null, "method"),
        });
        return { status: 201, body: policy.toJSON() };
    });
    router.get("/safety-stock-policies", async (req) => {
        const policies = await module.safetyStock.listPolicies(req.ctx);
        return { status: 200, body: { policies: policies.map((p) => p.toJSON()) } };
    });
    router.get("/safety-stock-policies/:id", async (req) => {
        const policy = await module.safetyStock.getPolicy(req.ctx, req.params.id);
        return { status: 200, body: policy.toJSON() };
    });
    router.put("/safety-stock-policies/:id/method", async (req) => {
        const policy = await module.safetyStock.changeMethod(req.ctx, req.params.id, asObject(req.body));
        return { status: 200, body: policy.toJSON() };
    });
    /** What-if calculator: no persistence, pure math over a demand series. */
    router.post("/safety-stock-policies/preview", async (req) => {
        const body = asObject(req.body);
        const series = body.weeklyDemandSeries;
        if (!Array.isArray(series) || !series.every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0)) {
            throw new DomainError("weeklyDemandSeries must be an array of non-negative numbers", "VALIDATION");
        }
        const result = module.safetyStock.preview({
            method: asObject(body.method ?? null, "method"),
            weeklyDemandSeries: series,
            leadTimeDays: requireNumber(body, "leadTimeDays"),
        });
        return { status: 200, body: result };
    });
}
//# sourceMappingURL=safety-stock.js.map
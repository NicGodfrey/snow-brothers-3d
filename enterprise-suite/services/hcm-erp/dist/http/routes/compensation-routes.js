import { actorId, asRecord, dateField, enumField, moneyField, optStr, queryInt, requireRole, str, ulidParam, } from "../parse.js";
import { created, jsonOk } from "../router.js";
const PAY_FREQUENCIES = ["monthly", "biweekly", "weekly"];
const CHANGE_REASONS = [
    "merit",
    "promotion",
    "market_adjustment",
    "demotion",
];
const RECURRENCES = ["per_pay_period", "annual"];
const BONUS_KINDS = ["performance", "signing", "retention", "spot"];
export function registerCompensationRoutes(router, module) {
    const { compensationService } = module;
    router.post("/employees/:id/compensation", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const record = compensationService.initialize(req.ctx.tenantId, {
            employeeId: ulidParam(req.params, "id"),
            annualBaseSalary: moneyField(body, "annualBaseSalary"),
            payFrequency: enumField(body, "payFrequency", PAY_FREQUENCIES),
            effectiveDate: dateField(body, "effectiveDate"),
            changedBy: actorId(req.ctx),
        });
        return created(record.toJSON());
    });
    router.get("/employees/:id/compensation", (req) => {
        const record = compensationService.getByEmployee(req.ctx.tenantId, ulidParam(req.params, "id"));
        return jsonOk({ ...record.toJSON(), perPeriodBase: record.perPeriodBase() });
    });
    router.post("/employees/:id/compensation/salary-change", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const record = compensationService.changeSalary(req.ctx.tenantId, ulidParam(req.params, "id"), {
            newAnnualSalary: moneyField(body, "newAnnualSalary"),
            effectiveDate: dateField(body, "effectiveDate"),
            reason: enumField(body, "reason", CHANGE_REASONS),
            changedBy: actorId(req.ctx),
            note: optStr(body, "note"),
        });
        return jsonOk(record.toJSON());
    });
    router.post("/employees/:id/compensation/allowances", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const record = compensationService.addAllowance(req.ctx.tenantId, ulidParam(req.params, "id"), {
            code: str(body, "code"),
            name: str(body, "name"),
            amount: moneyField(body, "amount"),
            recurrence: enumField(body, "recurrence", RECURRENCES),
        });
        return created(record.toJSON());
    });
    router.delete("/employees/:id/compensation/allowances/:code", (req) => {
        requireRole(req.ctx, "hr_admin");
        return jsonOk(compensationService
            .removeAllowance(req.ctx.tenantId, ulidParam(req.params, "id"), req.params.code)
            .toJSON());
    });
    router.post("/employees/:id/bonuses", (req) => {
        requireRole(req.ctx, "hr_admin", "manager");
        const body = asRecord(req.body);
        const bonus = compensationService.awardBonus(req.ctx.tenantId, {
            employeeId: ulidParam(req.params, "id"),
            kind: enumField(body, "kind", BONUS_KINDS),
            amount: moneyField(body, "amount"),
            awardedBy: actorId(req.ctx),
            payoutDate: dateField(body, "payoutDate"),
            note: optStr(body, "note"),
        });
        return created(bonus.toJSON());
    });
    router.get("/employees/:id/bonuses", (req) => jsonOk({
        items: compensationService
            .listBonuses(req.ctx.tenantId, ulidParam(req.params, "id"))
            .map((b) => b.toJSON()),
    }));
    router.post("/bonuses/:id/pay", (req) => {
        requireRole(req.ctx, "hr_admin");
        return jsonOk(compensationService.markBonusPaid(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
    });
    router.post("/bonuses/:id/cancel", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        return jsonOk(compensationService
            .cancelBonus(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "note"))
            .toJSON());
    });
    router.get("/employees/:id/payslip-preview", (req) => jsonOk(compensationService.payslipPreview(req.ctx.tenantId, ulidParam(req.params, "id"), queryInt(req.query, "year"), queryInt(req.query, "month"))));
}
//# sourceMappingURL=compensation-routes.js.map
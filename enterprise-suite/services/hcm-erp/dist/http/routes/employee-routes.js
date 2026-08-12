import { normalizePage, paginate } from "@enterprise-suite/shared-kernel";
import { TERMINATION_REASONS } from "../../domain/employee.js";
import { asRecord, bool, dateField, enumField, optStr, optUlid, requireRole, str, ulidParam, } from "../parse.js";
import { created, jsonOk } from "../router.js";
const STATUSES = ["active", "on_leave", "suspended", "terminated"];
export function registerEmployeeRoutes(router, module) {
    const { employeeService } = module;
    router.post("/employees", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        const employee = employeeService.hire(req.ctx.tenantId, {
            employeeNumber: str(body, "employeeNumber"),
            firstName: str(body, "firstName"),
            lastName: str(body, "lastName"),
            email: str(body, "email"),
            hireDate: dateField(body, "hireDate"),
            managerEmployeeId: optUlid(body, "managerEmployeeId"),
        });
        return created(employee.toJSON());
    });
    router.get("/employees", (req) => {
        const statusParam = req.query.get("status");
        const status = statusParam && STATUSES.includes(statusParam)
            ? statusParam
            : undefined;
        const employees = employeeService.listEmployees(req.ctx.tenantId, status).map((e) => e.toJSON());
        const page = normalizePage({
            page: Number(req.query.get("page") ?? 1),
            pageSize: Number(req.query.get("pageSize") ?? 20),
        });
        return jsonOk(paginate(employees, page));
    });
    router.get("/employees/:id", (req) => jsonOk(employeeService.getEmployee(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()));
    router.get("/employees/:id/reports", (req) => jsonOk({
        items: employeeService
            .directReports(req.ctx.tenantId, ulidParam(req.params, "id"))
            .map((e) => e.toJSON()),
    }));
    router.patch("/employees/:id", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        return jsonOk(employeeService
            .updateContactInfo(req.ctx.tenantId, ulidParam(req.params, "id"), {
            firstName: optStr(body, "firstName"),
            lastName: optStr(body, "lastName"),
            email: optStr(body, "email"),
        })
            .toJSON());
    });
    router.post("/employees/:id/manager", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        return jsonOk(employeeService
            .changeManager(req.ctx.tenantId, ulidParam(req.params, "id"), optUlid(body, "managerEmployeeId"))
            .toJSON());
    });
    router.post("/employees/:id/place-on-leave", (req) => {
        requireRole(req.ctx, "hr_admin", "manager");
        return jsonOk(employeeService.placeOnLeave(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
    });
    router.post("/employees/:id/return-from-leave", (req) => {
        requireRole(req.ctx, "hr_admin", "manager");
        return jsonOk(employeeService.returnFromLeave(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
    });
    router.post("/employees/:id/suspend", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        return jsonOk(employeeService.suspend(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "reason")).toJSON());
    });
    router.post("/employees/:id/reinstate", (req) => {
        requireRole(req.ctx, "hr_admin");
        return jsonOk(employeeService.reinstate(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
    });
    router.post("/employees/:id/terminate", (req) => {
        requireRole(req.ctx, "hr_admin");
        const body = asRecord(req.body);
        return jsonOk(employeeService
            .terminate(req.ctx.tenantId, ulidParam(req.params, "id"), {
            terminationDate: dateField(body, "terminationDate"),
            reason: enumField(body, "reason", TERMINATION_REASONS),
            rehireEligible: bool(body, "rehireEligible", true),
        })
            .toJSON());
    });
}
//# sourceMappingURL=employee-routes.js.map
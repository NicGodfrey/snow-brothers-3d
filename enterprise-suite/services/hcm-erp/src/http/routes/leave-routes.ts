import { isoDate, type IsoDate } from "../../domain/common.js";
import type { Holiday } from "../../domain/leave.js";
import { DomainError } from "@enterprise-suite/shared-kernel";
import type { HcmModule } from "../../module.js";
import {
  actorId,
  asRecord,
  dateField,
  int,
  num,
  optBool,
  optInt,
  optStr,
  queryInt,
  requireRole,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

function balanceView(balance: {
  toJSON(): object;
  availableDays: number;
  remainingDays: number;
}): object {
  return { ...balance.toJSON(), availableDays: balance.availableDays, remainingDays: balance.remainingDays };
}

export function registerLeaveRoutes(router: Router, module: HcmModule): void {
  const { leaveService } = module;

  // ---------------------------------------------------------------- policies

  router.post("/leave-policies", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const policy = leaveService.definePolicy(req.ctx.tenantId, {
      leaveType: str(body, "leaveType"),
      name: str(body, "name"),
      accrualDaysPerYear: num(body, "accrualDaysPerYear"),
      maxCarryoverDays: optInt(body, "maxCarryoverDays"),
      requiresApproval: optBool(body, "requiresApproval"),
      allowNegativeBalance: optBool(body, "allowNegativeBalance"),
      paid: optBool(body, "paid"),
    });
    return created(policy.toJSON());
  });

  router.get("/leave-policies", (req) =>
    jsonOk({ items: leaveService.listPolicies(req.ctx.tenantId).map((p) => p.toJSON()) }),
  );

  router.post("/holiday-calendars", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const rawHolidays = body.holidays;
    if (!Array.isArray(rawHolidays)) {
      throw new DomainError('Field "holidays" must be an array', "VALIDATION", 422);
    }
    const holidays: Holiday[] = rawHolidays.map((h, i) => {
      const record = asRecord(h);
      return { date: dateField(record, "date"), name: optStr(record, "name") ?? `holiday-${i + 1}` };
    });
    const calendar = leaveService.setHolidayCalendar(req.ctx.tenantId, int(body, "year"), holidays);
    return created(calendar.toJSON());
  });

  // ---------------------------------------------------------------- requests

  router.post("/leave-requests", (req) => {
    const body = asRecord(req.body);
    const request = leaveService.submitRequest(req.ctx.tenantId, {
      employeeId: ulidField(body, "employeeId"),
      leaveType: str(body, "leaveType"),
      startDate: dateField(body, "startDate"),
      endDate: dateField(body, "endDate"),
      reason: optStr(body, "reason"),
    });
    return created(request.toJSON());
  });

  router.get("/leave-requests/:id", (req) =>
    jsonOk(leaveService.getRequest(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.get("/employees/:id/leave-requests", (req) =>
    jsonOk({
      items: leaveService
        .listRequests(req.ctx.tenantId, ulidParam(req.params, "id"))
        .map((r) => r.toJSON()),
    }),
  );

  router.post("/leave-requests/:id/approve", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    return jsonOk(
      leaveService.approve(req.ctx.tenantId, ulidParam(req.params, "id"), actorId(req.ctx)).toJSON(),
    );
  });

  router.post("/leave-requests/:id/reject", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    const body = asRecord(req.body);
    return jsonOk(
      leaveService
        .reject(req.ctx.tenantId, ulidParam(req.params, "id"), actorId(req.ctx), str(body, "note"))
        .toJSON(),
    );
  });

  router.post("/leave-requests/:id/cancel", (req) =>
    jsonOk(leaveService.cancel(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  // ---------------------------------------------------------------- balances

  router.get("/employees/:id/leave-balances", (req) => {
    const yearRaw = req.query.get("year");
    const year = yearRaw === null ? undefined : Number(yearRaw);
    return jsonOk({
      items: leaveService
        .listBalances(req.ctx.tenantId, ulidParam(req.params, "id"), year)
        .map(balanceView),
    });
  });

  router.post("/employees/:id/leave-balances/:leaveType/grant", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const balance = leaveService.grantAnnualEntitlement(
      req.ctx.tenantId,
      ulidParam(req.params, "id"),
      req.params.leaveType,
      int(body, "year"),
    );
    return jsonOk(balanceView(balance));
  });

  router.post("/employees/:id/leave-balances/:leaveType/carry-over", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const days = leaveService.carryOver(
      req.ctx.tenantId,
      ulidParam(req.params, "id"),
      req.params.leaveType,
      int(body, "fromYear"),
    );
    return jsonOk({ carriedOverDays: days });
  });

  router.post("/leave-accruals/run", (req) => {
    requireRole(req.ctx, "hr_admin");
    const body = asRecord(req.body);
    const count = leaveService.runMonthlyAccrual(
      req.ctx.tenantId,
      str(body, "leaveType"),
      int(body, "year"),
      int(body, "month"),
    );
    return jsonOk({ employeesAccrued: count });
  });
}

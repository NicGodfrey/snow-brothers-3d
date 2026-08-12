import type { AttendanceEntryKind } from "../../domain/attendance.js";
import type { HcmModule } from "../../module.js";
import {
  actorId,
  asRecord,
  dateField,
  enumField,
  int,
  optInt,
  optStr,
  optTimeField,
  requireRole,
  str,
  ulidField,
  ulidParam,
} from "../parse.js";
import { created, jsonOk, type Router } from "../router.js";

const ENTRY_KINDS: readonly AttendanceEntryKind[] = [
  "work",
  "remote",
  "training",
  "leave",
  "sick",
  "holiday",
];

export function registerAttendanceRoutes(router: Router, module: HcmModule): void {
  const { attendanceService } = module;

  router.post("/attendance-periods", (req) => {
    const body = asRecord(req.body);
    const period = attendanceService.openPeriod(
      req.ctx.tenantId,
      ulidField(body, "employeeId"),
      int(body, "year"),
      int(body, "month"),
    );
    return created(period.toJSON());
  });

  router.get("/attendance-periods/:id", (req) =>
    jsonOk(attendanceService.getPeriod(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.get("/employees/:id/attendance-periods", (req) =>
    jsonOk({
      items: attendanceService
        .listPeriods(req.ctx.tenantId, ulidParam(req.params, "id"))
        .map((p) => p.toJSON()),
    }),
  );

  router.post("/attendance-periods/:id/entries", (req) => {
    const body = asRecord(req.body);
    const entry = attendanceService.addEntry(req.ctx.tenantId, ulidParam(req.params, "id"), {
      date: dateField(body, "date"),
      kind: enumField(body, "kind", ENTRY_KINDS),
      startTime: optTimeField(body, "startTime"),
      endTime: optTimeField(body, "endTime"),
      breakMinutes: optInt(body, "breakMinutes"),
      note: optStr(body, "note"),
    });
    return created(entry);
  });

  router.delete("/attendance-periods/:id/entries/:entryId", (req) =>
    jsonOk(
      attendanceService
        .removeEntry(req.ctx.tenantId, ulidParam(req.params, "id"), ulidParam(req.params, "entryId"))
        .toJSON(),
    ),
  );

  router.post("/attendance-periods/:id/submit", (req) =>
    jsonOk(attendanceService.submit(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON()),
  );

  router.post("/attendance-periods/:id/reopen", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    const body = asRecord(req.body);
    return jsonOk(
      attendanceService.reopen(req.ctx.tenantId, ulidParam(req.params, "id"), str(body, "note")).toJSON(),
    );
  });

  router.post("/attendance-periods/:id/approve", (req) => {
    requireRole(req.ctx, "hr_admin", "manager");
    return jsonOk(
      attendanceService.approve(req.ctx.tenantId, ulidParam(req.params, "id"), actorId(req.ctx)).toJSON(),
    );
  });

  router.post("/attendance-periods/:id/lock", (req) => {
    requireRole(req.ctx, "hr_admin");
    return jsonOk(attendanceService.lock(req.ctx.tenantId, ulidParam(req.params, "id")).toJSON());
  });

  router.get("/attendance-periods/:id/totals", (req) =>
    jsonOk(attendanceService.totals(req.ctx.tenantId, ulidParam(req.params, "id"))),
  );
}

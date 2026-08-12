import { DomainError } from "@enterprise-suite/shared-kernel";
import { CALENDAR_EXCEPTION_TYPES } from "../../domain/capacity-calendar.js";
import { asRecord, optionalNumber, optionalString, requireArray, requireNumber, requireOneOf, requireString, } from "../validate.js";
export function registerCapacityRoutes(router, container) {
    const service = container.services.capacity;
    /* ---------------------- shift templates ------------------------- */
    router.post("/shift-templates", async (req) => {
        const body = asRecord(req.body);
        const shifts = requireArray(body, "shifts").map((raw, i) => {
            const shift = asRecord(raw, `shifts[${i}]`);
            const days = requireArray(shift, "daysOfWeek").map((d) => {
                if (typeof d !== "number" || !Number.isInteger(d) || d < 0 || d > 6) {
                    throw new DomainError(`shifts[${i}].daysOfWeek must contain integers 0..6`, "VALIDATION", 400);
                }
                return d;
            });
            return {
                name: requireString(shift, "name"),
                startTime: requireString(shift, "startTime"),
                durationMinutes: requireNumber(shift, "durationMinutes"),
                breakMinutes: optionalNumber(shift, "breakMinutes"),
                daysOfWeek: days,
            };
        });
        const template = await service.createShiftTemplate(req.ctx, {
            code: requireString(body, "code"),
            name: requireString(body, "name"),
            shifts,
        });
        return { status: 201, body: template.toJSON() };
    });
    router.get("/shift-templates", async (req) => {
        return (await service.listShiftTemplates(req.ctx)).map((t) => t.toJSON());
    });
    router.get("/shift-templates/:id", async (req) => {
        return (await service.getShiftTemplate(req.ctx, req.params.id)).toJSON();
    });
    /* ------------------------- calendars ---------------------------- */
    router.post("/capacity-calendars", async (req) => {
        const body = asRecord(req.body);
        const calendar = await service.createCalendar(req.ctx, {
            code: requireString(body, "code"),
            name: requireString(body, "name"),
            shiftTemplateId: requireString(body, "shiftTemplateId"),
        });
        return { status: 201, body: calendar.toJSON() };
    });
    router.get("/capacity-calendars", async (req) => {
        return (await service.listCalendars(req.ctx)).map((c) => c.toJSON());
    });
    router.get("/capacity-calendars/:id", async (req) => {
        return (await service.getCalendar(req.ctx, req.params.id)).toJSON();
    });
    router.post("/capacity-calendars/:id/exceptions", async (req) => {
        const body = asRecord(req.body);
        const calendar = await service.addException(req.ctx, req.params.id, {
            date: requireString(body, "date"),
            type: requireOneOf(body, "type", CALENDAR_EXCEPTION_TYPES),
            minutes: optionalNumber(body, "minutes"),
            reason: optionalString(body, "reason"),
        });
        return { status: 201, body: calendar.toJSON() };
    });
    router.delete("/capacity-calendars/:id/exceptions/:date", async (req) => {
        const calendar = await service.removeException(req.ctx, req.params.id, req.params.date);
        return calendar.toJSON();
    });
    /* ---------------------- capacity queries ------------------------ */
    router.get("/work-centers/:id/capacity", async (req) => {
        const { from, to } = rangeFromQuery(req.query);
        return service.workCenterCapacity(req.ctx, req.params.id, from, to);
    });
    router.get("/work-centers/:id/load", async (req) => {
        const { from, to } = rangeFromQuery(req.query);
        return service.workCenterLoad(req.ctx, req.params.id, from, to);
    });
}
function rangeFromQuery(query) {
    const from = query.get("from");
    const to = query.get("to");
    if (!from || !to) {
        throw new DomainError("Query params 'from' and 'to' (ISO dates) are required", "VALIDATION", 400);
    }
    return { from, to };
}
//# sourceMappingURL=capacity.js.map
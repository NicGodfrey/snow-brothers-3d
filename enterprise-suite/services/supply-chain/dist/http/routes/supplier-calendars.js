import { DomainError } from "@enterprise-suite/shared-kernel";
import { asObject, optionalArray, optionalNumber, optionalString, queryInt, requireNumber, requireString } from "../validate.js";
function parseCapacityWeeks(raw) {
    return raw.map((entry, i) => {
        const obj = asObject(entry, `weeks[${i}]`);
        return { weekStart: requireString(obj, "weekStart"), capacityQty: requireNumber(obj, "capacityQty") };
    });
}
export function registerSupplierCalendarRoutes(router, module) {
    router.post("/supplier-calendars", async (req) => {
        const body = asObject(req.body);
        const weeksRaw = optionalArray(body, "weeks");
        const calendar = await module.capacity.createCalendar(req.ctx, {
            supplierId: requireString(body, "supplierId"),
            sku: optionalString(body, "sku"),
            name: optionalString(body, "name"),
            defaultWeeklyCapacity: optionalNumber(body, "defaultWeeklyCapacity"),
            weeks: weeksRaw ? parseCapacityWeeks(weeksRaw) : undefined,
        });
        return { status: 201, body: calendar.toJSON() };
    });
    router.get("/supplier-calendars", async (req) => {
        const calendars = await module.capacity.listCalendars(req.ctx, req.query.supplierId);
        return { status: 200, body: { calendars: calendars.map((c) => c.toJSON()) } };
    });
    router.get("/supplier-calendars/:id", async (req) => {
        const calendar = await module.capacity.getCalendar(req.ctx, req.params.id);
        return { status: 200, body: calendar.toJSON() };
    });
    router.put("/supplier-calendars/:id/weeks", async (req) => {
        const body = asObject(req.body);
        const weeks = body.weeks;
        if (!Array.isArray(weeks) || weeks.length === 0) {
            throw new DomainError("weeks must be a non-empty array", "VALIDATION");
        }
        const calendar = await module.capacity.setWeeks(req.ctx, req.params.id, parseCapacityWeeks(weeks));
        return { status: 200, body: calendar.toJSON() };
    });
    /** Capacity vs. load per week for one supplier across all of its items. */
    router.get("/supplier-capacity-load", async (req) => {
        const supplier = req.query.supplierId;
        if (!supplier)
            throw new DomainError("supplierId query parameter is required", "VALIDATION");
        const rows = await module.capacity.loadReport(req.ctx, supplier, queryInt(req.query, "weeks", 12, 1, 104));
        return { status: 200, body: { supplierId: supplier, rows } };
    });
}
//# sourceMappingURL=supplier-calendars.js.map
import { WORK_CENTER_STATUSES } from "../../domain/work-center.js";
import { asRecord, optionalArray, optionalNumber, optionalString, requireNumber, requireOneOf, requireString, } from "../validate.js";
export function registerWorkCenterRoutes(router, container) {
    const service = container.services.workCenters;
    router.post("/work-centers", async (req) => {
        const body = asRecord(req.body);
        const workCenter = await service.create(req.ctx, {
            code: requireString(body, "code"),
            name: requireString(body, "name"),
            description: optionalString(body, "description"),
            costCenterCode: optionalString(body, "costCenterCode"),
            machineCount: optionalNumber(body, "machineCount"),
            efficiencyPct: optionalNumber(body, "efficiencyPct"),
            utilizationPct: optionalNumber(body, "utilizationPct"),
            defaultQueueMinutes: optionalNumber(body, "defaultQueueMinutes"),
            currency: optionalString(body, "currency"),
            laborRatePerHourMinor: optionalNumber(body, "laborRatePerHourMinor"),
            machineRatePerHourMinor: optionalNumber(body, "machineRatePerHourMinor"),
            overheadRatePerHourMinor: optionalNumber(body, "overheadRatePerHourMinor"),
            tags: optionalArray(body, "tags")?.map(String),
        });
        return { status: 201, body: workCenter.toJSON() };
    });
    router.get("/work-centers", async (req) => {
        const workCenters = await service.list(req.ctx);
        return workCenters.map((wc) => wc.toJSON());
    });
    router.get("/work-centers/:id", async (req) => {
        const workCenter = await service.get(req.ctx, req.params.id);
        return workCenter.toJSON();
    });
    router.patch("/work-centers/:id", async (req) => {
        const body = asRecord(req.body);
        const workCenter = await service.update(req.ctx, req.params.id, {
            name: optionalString(body, "name"),
            description: optionalString(body, "description"),
            costCenterCode: optionalString(body, "costCenterCode"),
            machineCount: optionalNumber(body, "machineCount"),
            efficiencyPct: optionalNumber(body, "efficiencyPct"),
            utilizationPct: optionalNumber(body, "utilizationPct"),
            defaultQueueMinutes: optionalNumber(body, "defaultQueueMinutes"),
            tags: optionalArray(body, "tags")?.map(String),
        });
        return workCenter.toJSON();
    });
    router.post("/work-centers/:id/rates", async (req) => {
        const body = asRecord(req.body);
        const workCenter = await service.setRates(req.ctx, req.params.id, {
            currency: requireString(body, "currency"),
            laborRatePerHourMinor: requireNumber(body, "laborRatePerHourMinor"),
            machineRatePerHourMinor: requireNumber(body, "machineRatePerHourMinor"),
            overheadRatePerHourMinor: requireNumber(body, "overheadRatePerHourMinor"),
        });
        return workCenter.toJSON();
    });
    router.post("/work-centers/:id/status", async (req) => {
        const body = asRecord(req.body);
        const workCenter = await service.changeStatus(req.ctx, req.params.id, requireOneOf(body, "status", WORK_CENTER_STATUSES), optionalString(body, "reason"));
        return workCenter.toJSON();
    });
    router.post("/work-centers/:id/calendar", async (req) => {
        const body = asRecord(req.body);
        const workCenter = await service.assignCalendar(req.ctx, req.params.id, requireString(body, "calendarId"));
        return workCenter.toJSON();
    });
}
//# sourceMappingURL=work-centers.js.map
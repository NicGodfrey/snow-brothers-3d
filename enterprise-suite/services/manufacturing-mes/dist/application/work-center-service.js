import { ConflictError, money, NotFoundError, } from "@enterprise-suite/shared-kernel";
import { workCenterId } from "../domain/ids.js";
import { WorkCenter, } from "../domain/work-center.js";
export class WorkCenterService {
    workCenters;
    calendars;
    publisher;
    constructor(workCenters, calendars, publisher) {
        this.workCenters = workCenters;
        this.calendars = calendars;
        this.publisher = publisher;
    }
    async create(ctx, input) {
        const existing = await this.workCenters.findByCode(ctx.tenantId, input.code.toUpperCase());
        if (existing) {
            throw new ConflictError(`Work center code '${input.code}' already exists`);
        }
        const workCenter = WorkCenter.create(ctx.tenantId, input);
        await this.workCenters.save(workCenter);
        await this.publisher.publish(workCenter.pullEvents());
        return workCenter;
    }
    async get(ctx, id) {
        const workCenter = await this.workCenters.findById(ctx.tenantId, workCenterId(id));
        if (!workCenter)
            throw new NotFoundError("WorkCenter", id);
        return workCenter;
    }
    async list(ctx) {
        const all = await this.workCenters.list(ctx.tenantId);
        return all.sort((a, b) => a.code.localeCompare(b.code));
    }
    async update(ctx, id, patch) {
        const workCenter = await this.get(ctx, id);
        workCenter.update(patch);
        await this.workCenters.save(workCenter);
        await this.publisher.publish(workCenter.pullEvents());
        return workCenter;
    }
    async setRates(ctx, id, input) {
        const workCenter = await this.get(ctx, id);
        workCenter.setRates({
            laborRatePerHour: money(input.laborRatePerHourMinor, input.currency),
            machineRatePerHour: money(input.machineRatePerHourMinor, input.currency),
            overheadRatePerHour: money(input.overheadRatePerHourMinor, input.currency),
        });
        await this.workCenters.save(workCenter);
        await this.publisher.publish(workCenter.pullEvents());
        return workCenter;
    }
    async changeStatus(ctx, id, status, reason) {
        const workCenter = await this.get(ctx, id);
        workCenter.changeStatus(status, reason);
        await this.workCenters.save(workCenter);
        await this.publisher.publish(workCenter.pullEvents());
        return workCenter;
    }
    async assignCalendar(ctx, id, calendarId) {
        const workCenter = await this.get(ctx, id);
        const calendar = await this.calendars.findById(ctx.tenantId, calendarId);
        if (!calendar)
            throw new NotFoundError("CapacityCalendar", calendarId);
        workCenter.assignCalendar(calendar.id);
        await this.workCenters.save(workCenter);
        await this.publisher.publish(workCenter.pullEvents());
        return workCenter;
    }
    async getByIdOrThrow(ctx, id) {
        const workCenter = await this.workCenters.findById(ctx.tenantId, id);
        if (!workCenter)
            throw new NotFoundError("WorkCenter", id);
        return workCenter;
    }
}
//# sourceMappingURL=work-center-service.js.map
import { type TenantContext } from "@enterprise-suite/shared-kernel";
import { type WorkCenterId } from "../domain/ids.js";
import { WorkCenter, type CreateWorkCenterInput, type WorkCenterStatus } from "../domain/work-center.js";
import type { CapacityCalendarRepository, EventPublisher, WorkCenterRepository } from "./ports.js";
export declare class WorkCenterService {
    private readonly workCenters;
    private readonly calendars;
    private readonly publisher;
    constructor(workCenters: WorkCenterRepository, calendars: CapacityCalendarRepository, publisher: EventPublisher);
    create(ctx: TenantContext, input: CreateWorkCenterInput): Promise<WorkCenter>;
    get(ctx: TenantContext, id: string): Promise<WorkCenter>;
    list(ctx: TenantContext): Promise<WorkCenter[]>;
    update(ctx: TenantContext, id: string, patch: Parameters<WorkCenter["update"]>[0]): Promise<WorkCenter>;
    setRates(ctx: TenantContext, id: string, input: {
        currency: string;
        laborRatePerHourMinor: number;
        machineRatePerHourMinor: number;
        overheadRatePerHourMinor: number;
    }): Promise<WorkCenter>;
    changeStatus(ctx: TenantContext, id: string, status: WorkCenterStatus, reason?: string): Promise<WorkCenter>;
    assignCalendar(ctx: TenantContext, id: string, calendarId: string): Promise<WorkCenter>;
    getByIdOrThrow(ctx: TenantContext, id: WorkCenterId): Promise<WorkCenter>;
}
//# sourceMappingURL=work-center-service.d.ts.map
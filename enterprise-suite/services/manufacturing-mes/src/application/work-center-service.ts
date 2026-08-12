import {
  ConflictError,
  money,
  NotFoundError,
  type TenantContext,
} from "@enterprise-suite/shared-kernel";
import { workCenterId, type CapacityCalendarId, type WorkCenterId } from "../domain/ids.js";
import {
  WorkCenter,
  type CreateWorkCenterInput,
  type WorkCenterStatus,
} from "../domain/work-center.js";
import type {
  CapacityCalendarRepository,
  EventPublisher,
  WorkCenterRepository,
} from "./ports.js";

export class WorkCenterService {
  constructor(
    private readonly workCenters: WorkCenterRepository,
    private readonly calendars: CapacityCalendarRepository,
    private readonly publisher: EventPublisher,
  ) {}

  async create(ctx: TenantContext, input: CreateWorkCenterInput): Promise<WorkCenter> {
    const existing = await this.workCenters.findByCode(ctx.tenantId, input.code.toUpperCase());
    if (existing) {
      throw new ConflictError(`Work center code '${input.code}' already exists`);
    }
    const workCenter = WorkCenter.create(ctx.tenantId, input);
    await this.workCenters.save(workCenter);
    await this.publisher.publish(workCenter.pullEvents());
    return workCenter;
  }

  async get(ctx: TenantContext, id: string): Promise<WorkCenter> {
    const workCenter = await this.workCenters.findById(ctx.tenantId, workCenterId(id));
    if (!workCenter) throw new NotFoundError("WorkCenter", id);
    return workCenter;
  }

  async list(ctx: TenantContext): Promise<WorkCenter[]> {
    const all = await this.workCenters.list(ctx.tenantId);
    return all.sort((a, b) => a.code.localeCompare(b.code));
  }

  async update(
    ctx: TenantContext,
    id: string,
    patch: Parameters<WorkCenter["update"]>[0],
  ): Promise<WorkCenter> {
    const workCenter = await this.get(ctx, id);
    workCenter.update(patch);
    await this.workCenters.save(workCenter);
    await this.publisher.publish(workCenter.pullEvents());
    return workCenter;
  }

  async setRates(
    ctx: TenantContext,
    id: string,
    input: {
      currency: string;
      laborRatePerHourMinor: number;
      machineRatePerHourMinor: number;
      overheadRatePerHourMinor: number;
    },
  ): Promise<WorkCenter> {
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

  async changeStatus(
    ctx: TenantContext,
    id: string,
    status: WorkCenterStatus,
    reason?: string,
  ): Promise<WorkCenter> {
    const workCenter = await this.get(ctx, id);
    workCenter.changeStatus(status, reason);
    await this.workCenters.save(workCenter);
    await this.publisher.publish(workCenter.pullEvents());
    return workCenter;
  }

  async assignCalendar(ctx: TenantContext, id: string, calendarId: string): Promise<WorkCenter> {
    const workCenter = await this.get(ctx, id);
    const calendar = await this.calendars.findById(
      ctx.tenantId,
      calendarId as CapacityCalendarId,
    );
    if (!calendar) throw new NotFoundError("CapacityCalendar", calendarId);
    workCenter.assignCalendar(calendar.id as unknown as CapacityCalendarId);
    await this.workCenters.save(workCenter);
    await this.publisher.publish(workCenter.pullEvents());
    return workCenter;
  }

  async getByIdOrThrow(ctx: TenantContext, id: WorkCenterId): Promise<WorkCenter> {
    const workCenter = await this.workCenters.findById(ctx.tenantId, id);
    if (!workCenter) throw new NotFoundError("WorkCenter", id);
    return workCenter;
  }
}

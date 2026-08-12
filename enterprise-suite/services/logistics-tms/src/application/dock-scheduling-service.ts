import {
  ConflictError,
  NotFoundError,
  normalizePage,
  paginate,
  type Page,
  type PageRequest,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import {
  DockAppointment,
  type RequestDockAppointmentInput,
} from "../domain/dock-appointment.js";
import type { OutboxPort } from "../infrastructure/outbox.js";
import type { DockAppointmentRepository } from "../infrastructure/repositories.js";

export class DockSchedulingService {
  constructor(
    private readonly appointments: DockAppointmentRepository,
    private readonly outbox: OutboxPort,
  ) {}

  /**
   * Requests a dock slot. Overlap against any appointment that holds the
   * door (requested/confirmed/checked-in) is rejected up front so carriers
   * get an immediate, actionable conflict instead of a surprise later.
   */
  async requestAppointment(
    ctx: TenantContext,
    input: RequestDockAppointmentInput,
  ): Promise<DockAppointment> {
    const appointment = DockAppointment.request(ctx.tenantId, input);
    await this.assertNoConflict(ctx, appointment);
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async confirm(ctx: TenantContext, appointmentId: Ulid): Promise<DockAppointment> {
    const appointment = await this.requireAppointment(ctx, appointmentId);
    await this.assertNoConflict(ctx, appointment);
    appointment.confirm();
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async reschedule(
    ctx: TenantContext,
    appointmentId: Ulid,
    windowStart: string,
    windowEnd: string,
  ): Promise<DockAppointment> {
    const appointment = await this.requireAppointment(ctx, appointmentId);
    appointment.reschedule(windowStart, windowEnd);
    await this.assertNoConflict(ctx, appointment);
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async checkIn(ctx: TenantContext, appointmentId: Ulid, at?: string): Promise<DockAppointment> {
    const appointment = await this.requireAppointment(ctx, appointmentId);
    appointment.checkIn(at);
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async complete(ctx: TenantContext, appointmentId: Ulid, at?: string): Promise<DockAppointment> {
    const appointment = await this.requireAppointment(ctx, appointmentId);
    appointment.complete(at);
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async cancel(
    ctx: TenantContext,
    appointmentId: Ulid,
    reason?: string,
  ): Promise<DockAppointment> {
    const appointment = await this.requireAppointment(ctx, appointmentId);
    appointment.cancel(reason);
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async markNoShow(ctx: TenantContext, appointmentId: Ulid, at?: string): Promise<DockAppointment> {
    const appointment = await this.requireAppointment(ctx, appointmentId);
    appointment.markNoShow(at);
    await this.appointments.save(appointment);
    this.outbox.enqueue(appointment.pullEvents());
    return appointment;
  }

  async getAppointment(ctx: TenantContext, appointmentId: Ulid): Promise<DockAppointment> {
    return this.requireAppointment(ctx, appointmentId);
  }

  async listAppointments(
    ctx: TenantContext,
    filter?: { facilityCode?: string; status?: string; dateIso?: string },
    page?: Partial<PageRequest>,
  ): Promise<Page<DockAppointment>> {
    const items = await this.appointments.list(ctx.tenantId, filter);
    return paginate(items, normalizePage(page));
  }

  private async requireAppointment(
    ctx: TenantContext,
    appointmentId: Ulid,
  ): Promise<DockAppointment> {
    const appointment = await this.appointments.findById(ctx.tenantId, appointmentId);
    if (appointment === undefined) {
      throw new NotFoundError("DockAppointment", appointmentId);
    }
    return appointment;
  }

  private async assertNoConflict(
    ctx: TenantContext,
    appointment: DockAppointment,
  ): Promise<void> {
    const sameDoor = await this.appointments.listByDoor(
      ctx.tenantId,
      appointment.facilityCode,
      appointment.dockDoor,
    );
    const conflict = sameDoor.find((other) => appointment.overlaps(other));
    if (conflict !== undefined) {
      throw new ConflictError(
        `Dock ${appointment.facilityCode}/${appointment.dockDoor} is booked ` +
          `${conflict.windowStart}–${conflict.windowEnd} (${conflict.referenceCode})`,
      );
    }
  }
}

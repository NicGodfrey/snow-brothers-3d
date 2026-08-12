import { DomainError } from "@enterprise-suite/shared-kernel";
import type { DockSchedulingService } from "../../application/dock-scheduling-service.js";
import type { DockDirection } from "../../domain/dock-appointment.js";
import type { Router } from "../router.js";
import {
  expectObject,
  idParam,
  optId,
  optString,
  pageParams,
  reqString,
} from "../validate.js";

export function registerDockRoutes(router: Router, docks: DockSchedulingService): void {
  router.post("/dock-appointments", async (rc) => {
    const body = expectObject(rc.body);
    const direction = reqString(body, "direction");
    if (direction !== "inbound" && direction !== "outbound") {
      throw new DomainError("direction must be inbound or outbound", "VALIDATION");
    }
    const appointment = await docks.requestAppointment(rc.tenant, {
      facilityCode: reqString(body, "facilityCode"),
      dockDoor: reqString(body, "dockDoor"),
      direction: direction as DockDirection,
      carrierId: optId(body, "carrierId"),
      loadId: optId(body, "loadId"),
      windowStart: reqString(body, "windowStart"),
      windowEnd: reqString(body, "windowEnd"),
      notes: optString(body, "notes"),
    });
    return { status: 201, body: appointment };
  });

  router.get("/dock-appointments", async (rc) => {
    const page = await docks.listAppointments(
      rc.tenant,
      {
        facilityCode: rc.query.get("facility") ?? undefined,
        status: rc.query.get("status") ?? undefined,
        dateIso: rc.query.get("date") ?? undefined,
      },
      pageParams(rc.query),
    );
    return { status: 200, body: page };
  });

  router.get("/dock-appointments/:appointmentId", async (rc) => {
    const appointment = await docks.getAppointment(
      rc.tenant,
      idParam(rc.params, "appointmentId"),
    );
    return { status: 200, body: appointment };
  });

  router.post("/dock-appointments/:appointmentId/confirm", async (rc) => {
    const appointment = await docks.confirm(rc.tenant, idParam(rc.params, "appointmentId"));
    return { status: 200, body: appointment };
  });

  router.post("/dock-appointments/:appointmentId/reschedule", async (rc) => {
    const body = expectObject(rc.body);
    const appointment = await docks.reschedule(
      rc.tenant,
      idParam(rc.params, "appointmentId"),
      reqString(body, "windowStart"),
      reqString(body, "windowEnd"),
    );
    return { status: 200, body: appointment };
  });

  router.post("/dock-appointments/:appointmentId/check-in", async (rc) => {
    const body = rc.body === undefined ? {} : expectObject(rc.body);
    const appointment = await docks.checkIn(
      rc.tenant,
      idParam(rc.params, "appointmentId"),
      optString(body, "at"),
    );
    return { status: 200, body: appointment };
  });

  router.post("/dock-appointments/:appointmentId/complete", async (rc) => {
    const body = rc.body === undefined ? {} : expectObject(rc.body);
    const appointment = await docks.complete(
      rc.tenant,
      idParam(rc.params, "appointmentId"),
      optString(body, "at"),
    );
    return { status: 200, body: appointment };
  });

  router.post("/dock-appointments/:appointmentId/cancel", async (rc) => {
    const body = rc.body === undefined ? {} : expectObject(rc.body);
    const appointment = await docks.cancel(
      rc.tenant,
      idParam(rc.params, "appointmentId"),
      optString(body, "reason"),
    );
    return { status: 200, body: appointment };
  });

  router.post("/dock-appointments/:appointmentId/no-show", async (rc) => {
    const body = rc.body === undefined ? {} : expectObject(rc.body);
    const appointment = await docks.markNoShow(
      rc.tenant,
      idParam(rc.params, "appointmentId"),
      optString(body, "at"),
    );
    return { status: 200, body: appointment };
  });
}

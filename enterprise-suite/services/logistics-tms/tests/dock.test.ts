import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { makeWorld } from "./fixtures.js";

const DAY = "2026-09-01";

function slot(hourStart: number, hourEnd: number): { windowStart: string; windowEnd: string } {
  const pad = (h: number) => String(h).padStart(2, "0");
  return {
    windowStart: `${DAY}T${pad(hourStart)}:00:00.000Z`,
    windowEnd: `${DAY}T${pad(hourEnd)}:00:00.000Z`,
  };
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    facilityCode: "FRA-1",
    dockDoor: "D07",
    direction: "inbound" as const,
    ...slot(8, 10),
    ...overrides,
  };
}

describe("dock appointment scheduling", () => {
  it("requests and confirms a slot", async () => {
    const world = makeWorld();
    const appt = await world.docks.requestAppointment(world.ctx, baseRequest());
    assert.equal(appt.status, "requested");
    assert.match(appt.referenceCode, /^DOCK-/);

    const confirmed = await world.docks.confirm(world.ctx, appt.id);
    assert.equal(confirmed.status, "confirmed");
  });

  it("rejects overlapping requests on the same door", async () => {
    const world = makeWorld();
    await world.docks.requestAppointment(world.ctx, baseRequest());
    await assert.rejects(
      () => world.docks.requestAppointment(world.ctx, baseRequest(slot(9, 11))),
      /is booked/,
    );
  });

  it("allows adjacent windows and other doors/facilities", async () => {
    const world = makeWorld();
    await world.docks.requestAppointment(world.ctx, baseRequest());
    // back-to-back on the same door: [8,10) then [10,12)
    await world.docks.requestAppointment(world.ctx, baseRequest(slot(10, 12)));
    // overlapping but different door
    await world.docks.requestAppointment(
      world.ctx,
      baseRequest({ dockDoor: "D08", ...slot(9, 11) }),
    );
    // overlapping but different facility
    await world.docks.requestAppointment(
      world.ctx,
      baseRequest({ facilityCode: "MUC-2", ...slot(9, 11) }),
    );
    const all = await world.docks.listAppointments(world.ctx, {});
    assert.equal(all.total, 4);
  });

  it("frees the door when an appointment is cancelled", async () => {
    const world = makeWorld();
    const appt = await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.cancel(world.ctx, appt.id, "carrier cancelled");
    // Same window is now free
    const again = await world.docks.requestAppointment(world.ctx, baseRequest());
    assert.equal(again.status, "requested");
  });

  it("validates window duration bounds", async () => {
    const world = makeWorld();
    await assert.rejects(
      () =>
        world.docks.requestAppointment(world.ctx, {
          ...baseRequest(),
          windowStart: `${DAY}T08:00:00.000Z`,
          windowEnd: `${DAY}T08:10:00.000Z`,
        }),
      /at least 15 minutes/,
    );
    await assert.rejects(
      () => world.docks.requestAppointment(world.ctx, baseRequest(slot(8, 17))),
      /at most 8 hours/,
    );
  });

  it("enforces the check-in window with early grace", async () => {
    const world = makeWorld();
    const appt = await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.confirm(world.ctx, appt.id);

    // 45 minutes early: outside the 30-minute grace
    await assert.rejects(
      () => world.docks.checkIn(world.ctx, appt.id, `${DAY}T07:15:00.000Z`),
      /Too early to check in/,
    );
    // 20 minutes early: within grace
    const checkedIn = await world.docks.checkIn(world.ctx, appt.id, `${DAY}T07:40:00.000Z`);
    assert.equal(checkedIn.status, "checked_in");
  });

  it("rejects check-in after the window closes", async () => {
    const world = makeWorld();
    const appt = await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.confirm(world.ctx, appt.id);
    await assert.rejects(
      () => world.docks.checkIn(world.ctx, appt.id, `${DAY}T10:05:00.000Z`),
      /Window closed/,
    );
  });

  it("marks no-show only after the window has closed", async () => {
    const world = makeWorld();
    const appt = await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.confirm(world.ctx, appt.id);

    await assert.rejects(
      () => world.docks.markNoShow(world.ctx, appt.id, `${DAY}T09:00:00.000Z`),
      /before the window closes/,
    );
    const noShow = await world.docks.markNoShow(world.ctx, appt.id, `${DAY}T10:30:00.000Z`);
    assert.equal(noShow.status, "no_show");
  });

  it("completes the checked-in → completed flow", async () => {
    const world = makeWorld();
    const appt = await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.confirm(world.ctx, appt.id);
    await world.docks.checkIn(world.ctx, appt.id, `${DAY}T08:05:00.000Z`);
    const done = await world.docks.complete(world.ctx, appt.id, `${DAY}T09:10:00.000Z`);
    assert.equal(done.status, "completed");
  });

  it("sends rescheduled appointments back for re-confirmation and re-checks conflicts", async () => {
    const world = makeWorld();
    const first = await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.confirm(world.ctx, first.id);
    const second = await world.docks.requestAppointment(world.ctx, baseRequest(slot(12, 14)));

    // Rescheduling second onto first's window must conflict
    await assert.rejects(
      () =>
        world.docks.reschedule(
          world.ctx,
          second.id,
          `${DAY}T09:00:00.000Z`,
          `${DAY}T11:00:00.000Z`,
        ),
      /is booked/,
    );

    // Rescheduling to a free window works and resets to requested
    const moved = await world.docks.reschedule(
      world.ctx,
      second.id,
      `${DAY}T14:00:00.000Z`,
      `${DAY}T16:00:00.000Z`,
    );
    assert.equal(moved.status, "requested");
  });

  it("filters the schedule by facility and date", async () => {
    const world = makeWorld();
    await world.docks.requestAppointment(world.ctx, baseRequest());
    await world.docks.requestAppointment(
      world.ctx,
      baseRequest({ facilityCode: "MUC-2", ...slot(9, 11) }),
    );
    const fra = await world.docks.listAppointments(world.ctx, {
      facilityCode: "FRA-1",
      dateIso: DAY,
    });
    assert.equal(fra.total, 1);
    assert.equal(fra.items[0]!.facilityCode, "FRA-1");

    const otherDay = await world.docks.listAppointments(world.ctx, {
      facilityCode: "FRA-1",
      dateIso: "2026-09-02",
    });
    assert.equal(otherDay.total, 0);
  });
});

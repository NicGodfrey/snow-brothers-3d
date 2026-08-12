import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import { CapacityCalendar, weekdayOf } from "../src/domain/capacity-calendar.js";
import { shiftTemplateId } from "../src/domain/ids.js";
import { MON_TO_FRI, ShiftTemplate } from "../src/domain/shift-template.js";

const tenant = tenantId("tenant-a");

function fixture() {
  const template = ShiftTemplate.create(tenant, {
    code: "DAY",
    name: "Day shift",
    shifts: [
      {
        name: "Day",
        startTime: "08:00",
        durationMinutes: 480,
        breakMinutes: 30,
        daysOfWeek: [...MON_TO_FRI],
      },
    ],
  });
  const calendar = CapacityCalendar.create(tenant, {
    code: "PLANT",
    name: "Plant",
    shiftTemplateId: shiftTemplateId(template.id),
  });
  template.pullEvents();
  calendar.pullEvents();
  return { template, calendar };
}

describe("CapacityCalendar", () => {
  it("returns template minutes on normal working days and zero on weekends", () => {
    const { template, calendar } = fixture();
    assert.equal(weekdayOf("2026-08-03"), 1); // Monday
    assert.equal(calendar.availableMinutesOn("2026-08-03", template), 450);
    assert.equal(calendar.availableMinutesOn("2026-08-08", template), 0); // Saturday
  });

  it("applies HOLIDAY, DOWNTIME and OVERTIME exceptions", () => {
    const { template, calendar } = fixture();
    calendar.addException({ date: "2026-08-03", type: "HOLIDAY", reason: "Plant holiday" });
    calendar.addException({ date: "2026-08-04", type: "DOWNTIME", minutes: 120, reason: "PM" });
    calendar.addException({ date: "2026-08-05", type: "OVERTIME", minutes: 90 });

    assert.equal(calendar.availableMinutesOn("2026-08-03", template), 0);
    assert.equal(calendar.availableMinutesOn("2026-08-04", template), 330);
    assert.equal(calendar.availableMinutesOn("2026-08-05", template), 540);
  });

  it("clamps downtime at zero and rejects duplicate exceptions", () => {
    const { template, calendar } = fixture();
    calendar.addException({ date: "2026-08-06", type: "DOWNTIME", minutes: 9999 });
    assert.equal(calendar.availableMinutesOn("2026-08-06", template), 0);
    assert.throws(
      () => calendar.addException({ date: "2026-08-06", type: "HOLIDAY" }),
      /already has an exception/,
    );
  });

  it("requires positive minutes for DOWNTIME/OVERTIME and valid dates", () => {
    const { calendar } = fixture();
    assert.throws(() => calendar.addException({ date: "2026-08-07", type: "DOWNTIME" }), /minutes/);
    assert.throws(
      () => calendar.addException({ date: "2026-13-01", type: "HOLIDAY" }),
      /Invalid ISO date/,
    );
  });

  it("produces day-by-day availability including exceptions", () => {
    const { template, calendar } = fixture();
    calendar.addException({ date: "2026-08-05", type: "HOLIDAY" });
    const days = calendar.availabilityBetween("2026-08-03", "2026-08-09", template);
    assert.deepEqual(
      days.map((d) => d.minutes),
      [450, 450, 0, 450, 450, 0, 0], // Mon Tue HOLIDAY Thu Fri Sat Sun
    );
  });

  it("removes exceptions and errors when the exception is missing", () => {
    const { template, calendar } = fixture();
    calendar.addException({ date: "2026-08-05", type: "HOLIDAY" });
    calendar.removeException("2026-08-05");
    assert.equal(calendar.availableMinutesOn("2026-08-05", template), 450);
    assert.throws(() => calendar.removeException("2026-08-05"), /No calendar exception/);
  });
});

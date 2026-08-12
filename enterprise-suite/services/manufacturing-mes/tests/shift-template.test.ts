import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import {
  ALL_WEEKDAYS,
  MON_TO_FRI,
  parseTimeToMinutes,
  ShiftTemplate,
} from "../src/domain/shift-template.js";

const tenant = tenantId("tenant-a");

describe("parseTimeToMinutes", () => {
  it("parses HH:MM into minutes of day", () => {
    assert.equal(parseTimeToMinutes("00:00"), 0);
    assert.equal(parseTimeToMinutes("06:30"), 390);
    assert.equal(parseTimeToMinutes("23:59"), 1439);
  });

  it("rejects malformed times", () => {
    for (const bad of ["24:00", "7:30", "12:60", "noon", ""]) {
      assert.throws(() => parseTimeToMinutes(bad), /Invalid time/);
    }
  });
});

describe("ShiftTemplate", () => {
  it("computes net minutes per weekday and per week", () => {
    const template = ShiftTemplate.create(tenant, {
      code: "2x8",
      name: "Two shifts",
      shifts: [
        {
          name: "Early",
          startTime: "06:00",
          durationMinutes: 480,
          breakMinutes: 30,
          daysOfWeek: [...MON_TO_FRI],
        },
        {
          name: "Late",
          startTime: "14:00",
          durationMinutes: 480,
          breakMinutes: 30,
          daysOfWeek: [1, 2, 3, 4], // Mon–Thu
        },
      ],
    });
    assert.equal(template.netMinutesOn(1), 900); // Mon: 450 + 450
    assert.equal(template.netMinutesOn(5), 450); // Fri: early only
    assert.equal(template.netMinutesOn(0), 0); // Sun
    assert.equal(template.netMinutesPerWeek(), 4 * 900 + 450);
  });

  it("rejects overlapping shifts on the same weekday", () => {
    assert.throws(
      () =>
        ShiftTemplate.create(tenant, {
          code: "OVERLAP",
          name: "Overlap",
          shifts: [
            { name: "A", startTime: "06:00", durationMinutes: 480, daysOfWeek: [1] },
            { name: "B", startTime: "13:00", durationMinutes: 480, daysOfWeek: [1] },
          ],
        }),
      /overlap/i,
    );
  });

  it("allows back-to-back shifts and same times on different days", () => {
    const template = ShiftTemplate.create(tenant, {
      code: "OK",
      name: "Adjacent",
      shifts: [
        { name: "A", startTime: "06:00", durationMinutes: 480, daysOfWeek: [1] },
        { name: "B", startTime: "14:00", durationMinutes: 480, daysOfWeek: [1] },
        { name: "C", startTime: "06:00", durationMinutes: 480, daysOfWeek: [2] },
      ],
    });
    assert.equal(template.netMinutesOn(1), 960);
    assert.equal(template.netMinutesOn(2), 480);
  });

  it("rejects shifts crossing midnight", () => {
    assert.throws(
      () =>
        ShiftTemplate.create(tenant, {
          code: "NIGHT",
          name: "Night",
          shifts: [{ name: "N", startTime: "22:00", durationMinutes: 480, daysOfWeek: [1] }],
        }),
      /midnight/,
    );
  });

  it("rejects breaks as long as the shift and empty templates", () => {
    assert.throws(
      () =>
        ShiftTemplate.create(tenant, {
          code: "BRK",
          name: "Break",
          shifts: [
            {
              name: "A",
              startTime: "08:00",
              durationMinutes: 60,
              breakMinutes: 60,
              daysOfWeek: [1],
            },
          ],
        }),
      /Break/,
    );
    assert.throws(
      () => ShiftTemplate.create(tenant, { code: "EMPTY", name: "Empty", shifts: [] }),
      /at least one shift/,
    );
  });

  it("raises a created event", () => {
    const template = ShiftTemplate.create(tenant, {
      code: "EVT",
      name: "Event check",
      shifts: [{ name: "A", startTime: "08:00", durationMinutes: 480, daysOfWeek: [...ALL_WEEKDAYS] }],
    });
    const events = template.pullEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0]!.eventType, "mes.shift-template.created");
    assert.equal(events[0]!.tenantId, tenant);
  });
});

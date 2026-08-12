import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tenantId } from "@enterprise-suite/shared-kernel";
import { CapacityCalendar } from "../src/domain/capacity-calendar.js";
import { shiftTemplateId } from "../src/domain/ids.js";
import {
  backwardSchedule,
  forwardSchedule,
  windowsFromCalendar,
  type SchedulableOperation,
} from "../src/domain/scheduling.js";
import { MON_TO_FRI, ShiftTemplate } from "../src/domain/shift-template.js";

const tenant = tenantId("tenant-a");

/** Mon–Fri 08:00–16:00, no breaks. */
function plantWindows(withExceptions?: (cal: CapacityCalendar) => void) {
  const template = ShiftTemplate.create(tenant, {
    code: "DAY",
    name: "Day",
    shifts: [
      { name: "Day", startTime: "08:00", durationMinutes: 480, daysOfWeek: [...MON_TO_FRI] },
    ],
  });
  const calendar = CapacityCalendar.create(tenant, {
    code: "PLANT",
    name: "Plant",
    shiftTemplateId: shiftTemplateId(template.id),
  });
  withExceptions?.(calendar);
  return windowsFromCalendar(template, calendar);
}

function op(seq: number, over: Partial<SchedulableOperation> = {}): SchedulableOperation {
  return {
    seq,
    setupMinutes: 0,
    runMinutesPerUnit: 0,
    teardownMinutes: 0,
    queueMinutes: 0,
    moveMinutes: 0,
    ...over,
  };
}

describe("backwardSchedule", () => {
  it("packs operations against the due date within one day", () => {
    const windows = plantWindows();
    // op10: 30 setup + 100 run = 130; op20: 60 setup + 50 run + 30 teardown = 140.
    const result = backwardSchedule({
      operations: [
        op(10, { setupMinutes: 30, runMinutesPerUnit: 1 }),
        op(20, { setupMinutes: 60, runMinutesPerUnit: 0.5, teardownMinutes: 30 }),
      ],
      quantity: 100,
      dueDate: "2026-08-14", // Friday
      windows,
    });
    assert.equal(result.scheduledEnd, "2026-08-14T16:00:00.000Z");
    assert.equal(result.operations[1]!.start, "2026-08-14T13:40:00.000Z");
    assert.equal(result.operations[0]!.end, "2026-08-14T13:40:00.000Z");
    assert.equal(result.scheduledStart, "2026-08-14T11:30:00.000Z");
    assert.equal(result.totalWorkedMinutes, 270);
  });

  it("skips weekends when work does not fit before the due date", () => {
    const windows = plantWindows();
    // 600 worked minutes > 480/day: starts the previous Friday.
    const result = backwardSchedule({
      operations: [op(10, { runMinutesPerUnit: 6 })],
      quantity: 100,
      dueDate: "2026-08-10", // Monday
      windows,
    });
    assert.equal(result.scheduledEnd, "2026-08-10T16:00:00.000Z");
    // 480 min consumed Monday, remaining 120 on Friday 14:00–16:00.
    assert.equal(result.scheduledStart, "2026-08-07T14:00:00.000Z");
  });

  it("anchors on the previous working day when the due date is a holiday", () => {
    const windows = plantWindows((cal) =>
      cal.addException({ date: "2026-08-14", type: "HOLIDAY" }),
    );
    const result = backwardSchedule({
      operations: [op(10, { setupMinutes: 60 })],
      quantity: 1,
      dueDate: "2026-08-14", // holiday Friday -> anchor Thursday
      windows,
    });
    assert.equal(result.scheduledEnd, "2026-08-13T16:00:00.000Z");
    assert.equal(result.scheduledStart, "2026-08-13T15:00:00.000Z");
  });

  it("treats queue and move time as working-calendar time between ops", () => {
    const windows = plantWindows();
    const result = backwardSchedule({
      operations: [
        op(10, { setupMinutes: 60, moveMinutes: 30 }),
        op(20, { queueMinutes: 45, setupMinutes: 15 }),
      ],
      quantity: 1,
      dueDate: "2026-08-14",
      windows,
    });
    // Backward from 16:00: op20 worked 15 -> 15:45, queue 45 -> 15:00,
    // op10 move 30 -> 14:30 (op10 end), worked 60 -> 13:30.
    assert.equal(result.operations[1]!.end, "2026-08-14T16:00:00.000Z");
    assert.equal(result.operations[0]!.end, "2026-08-14T14:30:00.000Z");
    assert.equal(result.scheduledStart, "2026-08-14T13:30:00.000Z");
  });

  it("fails loudly when there is no working time at all", () => {
    const template = ShiftTemplate.create(tenant, {
      code: "SUN",
      name: "Sundays only",
      shifts: [{ name: "S", startTime: "08:00", durationMinutes: 60, daysOfWeek: [0] }],
    });
    const calendar = CapacityCalendar.create(tenant, {
      code: "C",
      name: "C",
      shiftTemplateId: shiftTemplateId(template.id),
    });
    // Every Sunday for years is a holiday -> nothing available.
    const windows = () => [] as ReturnType<ReturnType<typeof plantWindows>>;
    assert.throws(
      () =>
        backwardSchedule({
          operations: [op(10, { setupMinutes: 10 })],
          quantity: 1,
          dueDate: "2026-08-14",
          windows,
        }),
      /No working time/,
    );
    void calendar;
  });
});

describe("forwardSchedule", () => {
  it("starts at the first working moment and flows across days", () => {
    const windows = plantWindows();
    const result = forwardSchedule({
      operations: [
        op(10, { setupMinutes: 30, runMinutesPerUnit: 1 }), // 130 worked
        op(20, { queueMinutes: 60, setupMinutes: 60, runMinutesPerUnit: 3 }), // 360 worked
      ],
      quantity: 100,
      earliestStart: "2026-08-08", // Saturday -> first window Monday 08:00
      windows,
    });
    assert.equal(result.scheduledStart, "2026-08-10T08:00:00.000Z");
    // op10 ends 130 min after 08:00 Monday.
    assert.equal(result.operations[0]!.end, "2026-08-10T10:10:00.000Z");
    // queue 60 -> 11:10 start; 360 worked: 290 min left Monday (ends 16:00), 70 min Tuesday.
    assert.equal(result.operations[1]!.start, "2026-08-10T11:10:00.000Z");
    assert.equal(result.scheduledEnd, "2026-08-11T09:10:00.000Z");
  });

  it("respects overtime exceptions when scheduling forward", () => {
    const windows = plantWindows((cal) =>
      cal.addException({ date: "2026-08-10", type: "OVERTIME", minutes: 120 }),
    );
    const result = forwardSchedule({
      operations: [op(10, { runMinutesPerUnit: 5.5 })], // 550 min > 480 but <= 600
      quantity: 100,
      earliestStart: "2026-08-10",
      windows,
    });
    assert.equal(result.scheduledEnd, "2026-08-10T17:10:00.000Z");
  });
});

import { createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import { MON_TO_FRI } from "../src/domain/shift-template.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { createContainer, type MesContainer } from "../src/infrastructure/container.js";

/** Monday. All fixture dates are relative to this. */
export const TODAY = "2026-08-03";

export function testContext(tenant = "tenant-a", user = "user-1"): TenantContext {
  return createTenantContext(tenant, user, ["planner", "operator"]);
}

export function testContainer(): { container: MesContainer; clock: FixedClock } {
  const clock = new FixedClock(new Date(`${TODAY}T08:00:00Z`));
  return { container: createContainer({ clock }), clock };
}

export interface SeededPlant {
  templateId: string;
  calendarId: string;
  cncId: string;
  assemblyId: string;
  routingId: string;
}

/**
 * Standard fixture: one Mon–Fri 08:00–16:00 shift, a calendar, two work
 * centers (CNC + assembly, calendar assigned), and a released two-operation
 * routing for WIDGET-100:
 *   op 10 @ CNC:      setup 30, run 2.0/unit
 *   op 20 @ Assembly: setup 15, run 1.0/unit, teardown 15
 */
export async function seedPlant(container: MesContainer, ctx: TenantContext): Promise<SeededPlant> {
  const { capacity, workCenters, routings } = container.services;

  const template = await capacity.createShiftTemplate(ctx, {
    code: "DAY-1X8",
    name: "Single day shift",
    shifts: [
      {
        name: "Day",
        startTime: "08:00",
        durationMinutes: 480,
        breakMinutes: 0,
        daysOfWeek: [...MON_TO_FRI],
      },
    ],
  });
  const calendar = await capacity.createCalendar(ctx, {
    code: "PLANT-1",
    name: "Plant calendar",
    shiftTemplateId: template.id,
  });

  const cnc = await workCenters.create(ctx, {
    code: "CNC-01",
    name: "CNC milling",
    machineCount: 2,
    efficiencyPct: 90,
    utilizationPct: 80,
    currency: "USD",
    laborRatePerHourMinor: 4500,
    machineRatePerHourMinor: 9000,
    overheadRatePerHourMinor: 3000,
  });
  const assembly = await workCenters.create(ctx, {
    code: "ASSY-01",
    name: "Final assembly",
    machineCount: 1,
    efficiencyPct: 95,
    utilizationPct: 90,
  });
  await workCenters.assignCalendar(ctx, cnc.id, calendar.id);
  await workCenters.assignCalendar(ctx, assembly.id, calendar.id);

  const routing = await routings.create(ctx, {
    sku: "WIDGET-100",
    revision: "A",
    description: "Widget machining + assembly",
    operations: [
      {
        seq: 10,
        description: "Mill housing",
        workCenterId: cnc.id,
        setupMinutes: 30,
        runMinutesPerUnit: 2,
      },
      {
        seq: 20,
        description: "Assemble and test",
        workCenterId: assembly.id,
        setupMinutes: 15,
        runMinutesPerUnit: 1,
        teardownMinutes: 15,
      },
    ],
  });
  await routings.release(ctx, routing.id);

  return {
    templateId: template.id,
    calendarId: calendar.id,
    cncId: cnc.id,
    assemblyId: assembly.id,
    routingId: routing.id,
  };
}

/** Standard BOM for WIDGET-100 used across tests. */
export const WIDGET_BOM = [
  { componentSku: "CMP-HOUSING", qtyPerUnit: 1, uom: "EA", scrapFactorPct: 10, operationSeq: 10 },
  { componentSku: "CMP-SCREW", qtyPerUnit: 4, uom: "EA", operationSeq: 20 },
  { componentSku: "CMP-COOLANT", qtyPerUnit: 0.25, uom: "L" },
];

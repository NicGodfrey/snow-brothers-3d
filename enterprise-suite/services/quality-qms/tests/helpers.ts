/**
 * Shared test fixtures: module factory with a deterministic clock, tenant
 * contexts, and builders that walk aggregates into common states.
 */
import {
  brand,
  createTenantContext,
  type IsoDateTime,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { InspectionLot } from "../src/domain/inspection-lot.js";
import type { InspectionPlan } from "../src/domain/inspection-plan.js";
import { FixedClock } from "../src/infrastructure/in-memory/clock.js";
import { createQualityQmsModule, type QualityQmsModule } from "../src/infrastructure/module.js";

export interface TestHarness {
  module: QualityQmsModule;
  clock: FixedClock;
  ctx: TenantContext;
  qmCtx: TenantContext; // quality-manager role for approvals
}

export function harness(): TestHarness {
  const clock = new FixedClock("2026-08-12T09:00:00.000Z");
  const module = createQualityQmsModule({ clock });
  return {
    module,
    clock,
    ctx: createTenantContext("tenant-acme", "user-inspector", ["inspector"]),
    qmCtx: createTenantContext("tenant-acme", "user-qm", ["quality-manager"]),
  };
}

export function otherTenantCtx(): TenantContext {
  return createTenantContext("tenant-other", "user-other", ["inspector"]);
}

export function isoIn(clock: FixedClock, ms: number): IsoDateTime {
  return brand<string, "IsoDateTime">(new Date(new Date(clock.now()).getTime() + ms).toISOString());
}

/** Creates and activates a two-characteristic plan (1 quantitative + 1 attribute). */
export async function activePlan(h: TestHarness): Promise<InspectionPlan> {
  const plan = await h.module.services.plans.createPlan(h.ctx, {
    planCode: "QP-BRKT-01",
    name: "Bracket incoming inspection",
    targetType: "material",
    materialCode: "MAT-BRKT-100",
    samplingRule: { kind: "aql", level: "II", aql: 1.0 },
    characteristics: [
      {
        code: "DIA",
        name: "Bore diameter",
        type: "quantitative",
        criticality: "major",
        method: "caliper",
        quantitative: { unit: "mm", target: 10, lowerLimit: 9.9, upperLimit: 10.1 },
      },
      {
        code: "SURF",
        name: "Surface finish visual",
        type: "attribute",
        criticality: "minor",
        method: "visual",
      },
    ],
  });
  return h.module.services.plans.activatePlan(h.ctx, plan.id);
}

/** Creates a goods-receipt lot of 1000 units against the given plan. */
export async function createdLot(h: TestHarness, planId: Ulid): Promise<InspectionLot> {
  return h.module.services.lots.createLot(h.ctx, {
    planId,
    origin: "goods-receipt",
    quantity: 1000,
    uom: "EA",
    supplierId: "SUP-001",
    purchaseOrderRef: "PO-2026-0042",
    batchNumber: "B-77",
  });
}

/** Walks a lot to completed with all characteristics passing. */
export async function passingLot(h: TestHarness, planId: Ulid): Promise<InspectionLot> {
  const lot = await createdLot(h, planId);
  await h.module.services.lots.startInspection(h.ctx, lot.id);
  await h.module.services.lots.recordQuantitativeResult(h.ctx, lot.id, "DIA", [9.98, 10.0, 10.02, 9.95, 10.05]);
  await h.module.services.lots.recordAttributeResult(h.ctx, lot.id, "SURF", { inspected: 80, defective: 0 });
  return h.module.services.lots.completeInspection(h.ctx, lot.id);
}

/** Walks a lot to completed with the quantitative characteristic failing. */
export async function failingLot(h: TestHarness, planId: Ulid): Promise<InspectionLot> {
  const lot = await createdLot(h, planId);
  await h.module.services.lots.startInspection(h.ctx, lot.id);
  await h.module.services.lots.recordQuantitativeResult(h.ctx, lot.id, "DIA", [10.0, 10.25, 9.7, 10.02]);
  await h.module.services.lots.recordAttributeResult(h.ctx, lot.id, "SURF", { inspected: 80, defective: 1 });
  return h.module.services.lots.completeInspection(h.ctx, lot.id);
}

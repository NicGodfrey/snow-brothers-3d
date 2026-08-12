import { brand, newId, type Brand, type Ulid } from "@enterprise-suite/shared-kernel";

/** Branded aggregate identifiers so ids of different aggregates cannot be mixed up. */
export type WorkCenterId = Brand<string, "WorkCenterId">;
export type ShiftTemplateId = Brand<string, "ShiftTemplateId">;
export type CapacityCalendarId = Brand<string, "CapacityCalendarId">;
export type RoutingId = Brand<string, "RoutingId">;
export type WorkOrderId = Brand<string, "WorkOrderId">;
export type MaterialIssueId = Brand<string, "MaterialIssueId">;
export type ProductionReceiptId = Brand<string, "ProductionReceiptId">;
export type ScrapRecordId = Brand<string, "ScrapRecordId">;

export const workCenterId = (v?: string): WorkCenterId =>
  brand<string, "WorkCenterId">(v ?? newId("wc"));
export const shiftTemplateId = (v?: string): ShiftTemplateId =>
  brand<string, "ShiftTemplateId">(v ?? newId("shift"));
export const capacityCalendarId = (v?: string): CapacityCalendarId =>
  brand<string, "CapacityCalendarId">(v ?? newId("cal"));
export const routingId = (v?: string): RoutingId => brand<string, "RoutingId">(v ?? newId("rtg"));
export const workOrderId = (v?: string): WorkOrderId =>
  brand<string, "WorkOrderId">(v ?? newId("wo"));
export const materialIssueId = (v?: string): MaterialIssueId =>
  brand<string, "MaterialIssueId">(v ?? newId("mi"));
export const productionReceiptId = (v?: string): ProductionReceiptId =>
  brand<string, "ProductionReceiptId">(v ?? newId("pr"));
export const scrapRecordId = (v?: string): ScrapRecordId =>
  brand<string, "ScrapRecordId">(v ?? newId("scrap"));

/** Convert a branded domain id to the kernel Ulid used in event envelopes. */
export const asUlid = (id: string): Ulid => brand<string, "Ulid">(id);

/** Units of measure the MES understands. Kept as a closed list so math stays safe. */
export const UNITS_OF_MEASURE = ["EA", "KG", "G", "L", "ML", "M", "CM", "M2", "HR"] as const;
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];

export function isUnitOfMeasure(value: string): value is UnitOfMeasure {
  return (UNITS_OF_MEASURE as readonly string[]).includes(value);
}

/** Quantity value object: a decimal amount tied to a unit of measure. */
export interface Quantity {
  readonly value: number;
  readonly uom: UnitOfMeasure;
}

export function qty(value: number, uom: UnitOfMeasure): Quantity {
  if (!Number.isFinite(value)) throw new Error("Quantity must be finite");
  // Round to 6 decimals to avoid FP drift accumulating through issue/receipt math.
  return { value: Math.round(value * 1e6) / 1e6, uom };
}

export function addQty(a: Quantity, b: Quantity): Quantity {
  assertSameUom(a, b);
  return qty(a.value + b.value, a.uom);
}

export function subQty(a: Quantity, b: Quantity): Quantity {
  assertSameUom(a, b);
  return qty(a.value - b.value, a.uom);
}

export function scaleQty(a: Quantity, factor: number): Quantity {
  return qty(a.value * factor, a.uom);
}

function assertSameUom(a: Quantity, b: Quantity): void {
  if (a.uom !== b.uom) {
    throw new Error(`Unit of measure mismatch: ${a.uom} vs ${b.uom}`);
  }
}

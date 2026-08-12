import { type Brand, type Ulid } from "@enterprise-suite/shared-kernel";
/** Branded aggregate identifiers so ids of different aggregates cannot be mixed up. */
export type WorkCenterId = Brand<string, "WorkCenterId">;
export type ShiftTemplateId = Brand<string, "ShiftTemplateId">;
export type CapacityCalendarId = Brand<string, "CapacityCalendarId">;
export type RoutingId = Brand<string, "RoutingId">;
export type WorkOrderId = Brand<string, "WorkOrderId">;
export type MaterialIssueId = Brand<string, "MaterialIssueId">;
export type ProductionReceiptId = Brand<string, "ProductionReceiptId">;
export type ScrapRecordId = Brand<string, "ScrapRecordId">;
export declare const workCenterId: (v?: string) => WorkCenterId;
export declare const shiftTemplateId: (v?: string) => ShiftTemplateId;
export declare const capacityCalendarId: (v?: string) => CapacityCalendarId;
export declare const routingId: (v?: string) => RoutingId;
export declare const workOrderId: (v?: string) => WorkOrderId;
export declare const materialIssueId: (v?: string) => MaterialIssueId;
export declare const productionReceiptId: (v?: string) => ProductionReceiptId;
export declare const scrapRecordId: (v?: string) => ScrapRecordId;
/** Convert a branded domain id to the kernel Ulid used in event envelopes. */
export declare const asUlid: (id: string) => Ulid;
/** Units of measure the MES understands. Kept as a closed list so math stays safe. */
export declare const UNITS_OF_MEASURE: readonly ["EA", "KG", "G", "L", "ML", "M", "CM", "M2", "HR"];
export type UnitOfMeasure = (typeof UNITS_OF_MEASURE)[number];
export declare function isUnitOfMeasure(value: string): value is UnitOfMeasure;
/** Quantity value object: a decimal amount tied to a unit of measure. */
export interface Quantity {
    readonly value: number;
    readonly uom: UnitOfMeasure;
}
export declare function qty(value: number, uom: UnitOfMeasure): Quantity;
export declare function addQty(a: Quantity, b: Quantity): Quantity;
export declare function subQty(a: Quantity, b: Quantity): Quantity;
export declare function scaleQty(a: Quantity, factor: number): Quantity;
//# sourceMappingURL=ids.d.ts.map
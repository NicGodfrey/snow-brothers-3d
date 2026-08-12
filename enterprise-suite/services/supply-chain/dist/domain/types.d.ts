import { type Brand } from "@enterprise-suite/shared-kernel";
/** Plain calendar date, `YYYY-MM-DD`, always interpreted in UTC. */
export type IsoDate = Brand<string, "IsoDate">;
/** Warehouse / plant identifier the plan applies to. */
export type LocationCode = Brand<string, "LocationCode">;
/** External supplier identifier (owned by SRM, referenced here). */
export type SupplierId = Brand<string, "SupplierId">;
export declare function locationCode(value: string): LocationCode;
export declare function supplierId(value: string): SupplierId;
/**
 * Quantities in this domain are plain numbers with at most 3 decimal places
 * (e.g. kilograms). All arithmetic rounds through {@link roundQty} to keep
 * floating point noise out of comparisons and persisted values.
 */
export declare function roundQty(value: number): number;
export declare function assertQty(name: string, value: unknown, opts?: {
    allowZero?: boolean;
}): number;
export declare function assertIntInRange(name: string, value: unknown, min: number, max: number): number;
export type UnitOfMeasure = "EA" | "KG" | "L" | "M" | "BOX";
export declare const UNITS_OF_MEASURE: readonly UnitOfMeasure[];
export declare function assertUom(value: unknown): UnitOfMeasure;
//# sourceMappingURL=types.d.ts.map
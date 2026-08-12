import { type LocationCode } from "../domain/types.js";
/** Minimal hand-rolled body/query validation for the HTTP boundary. */
export declare function asObject(body: unknown, name?: string): Record<string, unknown>;
export declare function requireString(obj: Record<string, unknown>, key: string): string;
export declare function optionalString(obj: Record<string, unknown>, key: string): string | undefined;
export declare function requireNumber(obj: Record<string, unknown>, key: string): number;
export declare function optionalNumber(obj: Record<string, unknown>, key: string): number | undefined;
export declare function optionalBoolean(obj: Record<string, unknown>, key: string): boolean | undefined;
export declare function requireArray(obj: Record<string, unknown>, key: string): unknown[];
export declare function optionalArray(obj: Record<string, unknown>, key: string): unknown[] | undefined;
export declare function requireLocation(source: Record<string, unknown> | Record<string, string>, key?: string): LocationCode;
export declare function queryInt(query: Record<string, string>, key: string, fallback: number, min: number, max: number): number;
export declare function parseWeekEntries(raw: unknown[]): {
    weekStart: string;
    qty: number;
}[];
//# sourceMappingURL=validate.d.ts.map
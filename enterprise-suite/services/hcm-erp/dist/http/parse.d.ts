import { type Money, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { type IsoDate, type TimeOfDay } from "../domain/common.js";
export declare function asRecord(body: unknown): Record<string, unknown>;
export declare function str(body: Record<string, unknown>, field: string): string;
export declare function optStr(body: Record<string, unknown>, field: string): string | undefined;
export declare function num(body: Record<string, unknown>, field: string): number;
export declare function optNum(body: Record<string, unknown>, field: string): number | undefined;
export declare function int(body: Record<string, unknown>, field: string): number;
export declare function optInt(body: Record<string, unknown>, field: string): number | undefined;
export declare function bool(body: Record<string, unknown>, field: string, fallback?: boolean): boolean;
export declare function optBool(body: Record<string, unknown>, field: string): boolean | undefined;
export declare function dateField(body: Record<string, unknown>, field: string): IsoDate;
export declare function optDateField(body: Record<string, unknown>, field: string): IsoDate | undefined;
export declare function timeField(body: Record<string, unknown>, field: string): TimeOfDay;
export declare function optTimeField(body: Record<string, unknown>, field: string): TimeOfDay | undefined;
/** Expects `{ amountMinor: int, currency: "XXX" }`. */
export declare function moneyField(body: Record<string, unknown>, field: string): Money;
export declare function optMoneyField(body: Record<string, unknown>, field: string): Money | undefined;
export declare function ulidParam(params: Readonly<Record<string, string>>, name: string): Ulid;
export declare function optUlid(body: Record<string, unknown>, field: string): Ulid | undefined;
export declare function ulidField(body: Record<string, unknown>, field: string): Ulid;
export declare function queryInt(query: URLSearchParams, name: string, fallback?: number): number;
export declare function enumField<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T;
export declare function optEnumField<T extends string>(body: Record<string, unknown>, field: string, allowed: readonly T[]): T | undefined;
/** The acting user (from `x-user-id`) as a Ulid for audit fields. */
export declare function actorId(ctx: TenantContext): Ulid;
/** Role gate for privileged endpoints; roles come from the `x-roles` header. */
export declare function requireRole(ctx: TenantContext, ...anyOf: string[]): void;
//# sourceMappingURL=parse.d.ts.map
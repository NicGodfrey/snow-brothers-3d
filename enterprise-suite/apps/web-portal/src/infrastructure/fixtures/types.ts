import { money, type Money } from "@enterprise-suite/shared-kernel";
import type { ModuleSummaryDto } from "../../api/module-api.js";
import type { RowLike } from "../../api/types.js";
import type { ModuleKey } from "../../domain/module.js";

/**
 * Fixture shape backing the mock transport.
 *
 * A resource is one list endpoint: rows plus the metadata the mock needs to
 * answer `?q=` filtering and `/search` without a per-module special case.
 */

export interface FixtureContext {
  readonly tenantId: string;
  /** Reporting currency for the tenant. */
  readonly currency: string;
  /** Document-number prefix, so tenants are distinguishable at a glance. */
  readonly prefix: string;
  readonly now: string;
}

/** DTOs are plain interfaces, so rows only have to carry an `id`. */
export interface Identified {
  readonly id: string;
}

export interface ResourceFixture<T extends Identified = RowLike> {
  readonly slug: string;
  readonly rows: readonly T[];
  readonly searchable: readonly string[];
  readonly title: (row: T) => string;
  readonly subtitle: (row: T) => string;
}

export interface ModuleFixture {
  readonly module: ModuleKey;
  readonly resources: readonly ResourceFixture[];
  readonly summary: ModuleSummaryDto;
}

export type FixtureBuilder = (ctx: FixtureContext) => ModuleFixture;

export function resource<T extends Identified>(fixture: ResourceFixture<T>): ResourceFixture {
  return fixture as unknown as ResourceFixture;
}

export function amount(ctx: FixtureContext, minor: number): Money {
  return money(minor, ctx.currency);
}

/** Deterministic date helper: `days` relative to the fixture's "now". */
export function shiftDays(ctx: FixtureContext, days: number): string {
  return new Date(Date.parse(ctx.now) + days * 86_400_000).toISOString();
}

export function dateOnly(ctx: FixtureContext, days: number): string {
  return shiftDays(ctx, days).slice(0, 10);
}

export function docNumber(ctx: FixtureContext, kind: string, seq: number): string {
  return `${kind}-${ctx.prefix}-${String(1000 + seq)}`;
}

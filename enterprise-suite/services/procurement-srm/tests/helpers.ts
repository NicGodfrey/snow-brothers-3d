import assert from "node:assert/strict";
import { DomainError, brand, money, tenantId, type Money, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import { isoDate, type IsoDate } from "../src/domain/common.js";
import { seedDemoTenant, type SeedResult } from "../src/fixtures/seed.js";
import { FixedClock } from "../src/infrastructure/in-memory.js";
import { createProcurementModule, type ProcurementModule } from "../src/module.js";

export interface TestContext {
  module: ProcurementModule;
  clock: FixedClock;
  tenant: TenantId;
}

export function buildModule(today = "2026-03-02"): TestContext {
  const clock = new FixedClock(isoDate(today));
  const module = createProcurementModule({ clock });
  return { module, clock, tenant: tenantId("test-tenant") };
}

export interface SeededContext extends TestContext {
  seed: SeedResult;
}

export function buildSeededModule(today = "2026-03-02"): SeededContext {
  const { module, clock } = buildModule(today);
  const seed = seedDemoTenant(module, "acme");
  module.outbox.drain(); // discard seeding events so tests assert only their own
  return { module, clock, tenant: seed.tenant, seed };
}

/** Asserts that `fn` throws a DomainError carrying the expected code. */
export function assertDomainError(fn: () => unknown, expectedCode: string): DomainError {
  try {
    fn();
  } catch (error) {
    assert.ok(
      error instanceof DomainError,
      `Expected DomainError, got ${error instanceof Error ? error.constructor.name : typeof error}: ${String(error)}`,
    );
    assert.equal(
      error.code,
      expectedCode,
      `Expected error code ${expectedCode}, got ${error.code} (${error.message})`,
    );
    return error;
  }
  assert.fail(`Expected DomainError ${expectedCode} but nothing was thrown`);
}

export function eventTypes(module: ProcurementModule): string[] {
  return module.outbox.peek().map((event) => event.eventType);
}

export function assertEmitted(module: ProcurementModule, eventType: string): void {
  const emitted = eventTypes(module);
  assert.ok(
    emitted.includes(eventType),
    `Expected ${eventType} in outbox, saw:\n  ${emitted.join("\n  ")}`,
  );
}

export const d = isoDate;

export function id(value: string): Ulid {
  return brand<string, "Ulid">(value);
}

export function usd(amountMinor: number): Money {
  return money(amountMinor, "USD");
}

export function plusDays(date: IsoDate, days: number): IsoDate {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return isoDate(parsed.toISOString().slice(0, 10));
}

/**
 * Registers an active supplier for the categories a test needs, bypassing the
 * seed so each suite can control the directory it works against.
 */
export function registerSupplier(
  ctx: TestContext,
  overrides: { supplierNumber?: string; categories?: readonly string[]; minimumOrderValue?: Money } = {},
) {
  return ctx.module.supplierDirectory.register(ctx.tenant, {
    supplierNumber: overrides.supplierNumber ?? "SUP-9001",
    legalName: "Test Supply Co",
    currency: "USD",
    status: "active",
    paymentTermsDays: 30,
    categories: overrides.categories ?? ["IND.OFFICE"],
    qualityScoreBps: 9_000,
    defaultLeadTimeDays: 7,
    minimumOrderValue: overrides.minimumOrderValue,
  });
}

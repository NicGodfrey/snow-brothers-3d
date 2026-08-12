import assert from "node:assert/strict";
import { DomainError, tenantId, type TenantId } from "@enterprise-suite/shared-kernel";
import { isoDate } from "../src/domain/common.js";
import { FixedClock } from "../src/infrastructure/in-memory.js";
import { createHcmModule, type HcmModule } from "../src/module.js";
import { seedDemoTenant, type SeedResult } from "../src/fixtures/seed.js";

export interface TestContext {
  module: HcmModule;
  clock: FixedClock;
  tenant: TenantId;
}

export function buildModule(today = "2026-01-15"): TestContext {
  const clock = new FixedClock(isoDate(today));
  const module = createHcmModule({ clock });
  return { module, clock, tenant: tenantId("test-tenant") };
}

export interface SeededContext extends TestContext {
  seed: SeedResult;
}

export function buildSeededModule(today = "2026-01-15"): SeededContext {
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

export function eventTypes(module: HcmModule): string[] {
  return module.outbox.peek().map((e) => e.eventType);
}

export const d = isoDate;

import { createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import { createContainer, type MasterDataContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";

export interface TestWorld {
  readonly container: MasterDataContainer;
  readonly clock: FixedClock;
  readonly ctx: TenantContext;
}

/** Fresh container with a deterministic clock and a data-steward user. */
export function world(tenant = "acme", user = "steward-1"): TestWorld {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const container = createContainer({ clock });
  return { container, clock, ctx: createTenantContext(tenant, user, ["mdm.admin"]) };
}

export const DAY_MS = 24 * 3600 * 1000;

/** A minimal valid US address, for tests that do not care about geography. */
export const US_ADDRESS = {
  line1: "500 Boylston Street",
  city: "Boston",
  region: "MA",
  postalCode: "02116",
  countryCode: "US",
} as const;

export async function expectRejects(
  promise: Promise<unknown>,
  code: string,
  messageIncludes?: string,
): Promise<void> {
  try {
    await promise;
  } catch (error) {
    const err = error as { code?: string; message?: string; details?: unknown };
    if (err.code !== code) {
      throw new Error(`Expected error code ${code}, got ${err.code}: ${err.message}`);
    }
    // Validation errors carry per-field issues in details; search both.
    const haystack = `${err.message ?? ""} ${err.details ? JSON.stringify(err.details) : ""}`;
    if (messageIncludes && !haystack.includes(messageIncludes)) {
      throw new Error(`Expected message to include "${messageIncludes}", got: ${haystack}`);
    }
    return;
  }
  throw new Error(`Expected rejection with code ${code}, but promise resolved`);
}

/** Synchronous counterpart for the pure domain functions. */
export function expectThrows(fn: () => unknown, code: string, messageIncludes?: string): void {
  try {
    fn();
  } catch (error) {
    const err = error as { code?: string; message?: string; details?: unknown };
    if (err.code !== code) {
      throw new Error(`Expected error code ${code}, got ${err.code}: ${err.message}`);
    }
    const haystack = `${err.message ?? ""} ${err.details ? JSON.stringify(err.details) : ""}`;
    if (messageIncludes && !haystack.includes(messageIncludes)) {
      throw new Error(`Expected message to include "${messageIncludes}", got: ${haystack}`);
    }
    return;
  }
  throw new Error(`Expected throw with code ${code}, but the call returned`);
}

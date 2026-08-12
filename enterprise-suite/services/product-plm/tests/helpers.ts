import { createTenantContext, type TenantContext } from "@enterprise-suite/shared-kernel";
import { createContainer, type PlmContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";

export interface TestWorld {
  readonly container: PlmContainer;
  readonly clock: FixedClock;
  readonly ctx: TenantContext;
}

/** Fresh container with a deterministic clock and a default engineer user. */
export function world(tenant = "acme", user = "engineer-1"): TestWorld {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const container = createContainer({ clock });
  return { container, clock, ctx: createTenantContext(tenant, user, ["plm.admin"]) };
}

export const DAY_MS = 24 * 3600 * 1000;

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

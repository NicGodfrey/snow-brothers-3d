import { createTenantContext, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { DateOnly } from "../src/domain/dates.js";
import type { Supplier } from "../src/domain/supplier.js";
import { createContainer, type SrmContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";

export interface TestWorld {
  readonly container: SrmContainer;
  readonly clock: FixedClock;
  readonly ctx: TenantContext;
  /** Today under the fixed clock, for building relative dates. */
  readonly today: DateOnly;
}

/** Fresh container with a deterministic clock and a full-rights buyer. */
export function world(tenant = "acme", user = "buyer-1"): TestWorld {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const container = createContainer({ clock });
  const ctx = createTenantContext(tenant, user, [
    "srm.admin",
    "srm.compliance",
    "srm.quality",
    "srm.category-manager",
  ]);
  return { container, clock, ctx, today: clock.today() };
}

/** Same tenant, different actor — for approval-matrix and role tests. */
export function actor(ctx: TenantContext, user: string, roles: string[] = ["srm.buyer"]): TenantContext {
  return createTenantContext(ctx.tenantId, user, roles);
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

/** Registers a supplier with the master data activation requires. */
export async function tradingSupplier(
  w: TestWorld,
  code = "ACME-PARTS",
  overrides: { countryCode?: string; currency?: string } = {},
) {
  const { services } = w.container;
  const countryCode = overrides.countryCode ?? "DE";
  const supplier = await services.supplier.register(w.ctx, {
    code,
    legalName: `${code} GmbH`,
    countryCode,
    taxId: `${countryCode}123456789`,
    defaultCurrency: overrides.currency ?? "EUR",
  });
  await services.supplier.addSite(w.ctx, supplier.id, {
    code: `${code}-P1`,
    name: "Main plant",
    type: "manufacturing",
    address: { line1: "1 Werkstrasse", city: "Stuttgart", countryCode },
    capabilities: ["machining"],
  });
  await services.supplier.addContact(w.ctx, supplier.id, {
    name: "Sales Desk",
    email: `sales@${code.toLowerCase()}.example`,
    role: "primary",
  });
  return services.supplier.get(w.ctx, supplier.id);
}

/**
 * Walks a registered supplier through a low-risk onboarding case to `active`.
 * Activation is only reachable through onboarding, so tests that need a
 * trading supplier have to run the gate rather than skip it.
 */
export async function activate(w: TestWorld, supplierId: Ulid): Promise<Supplier> {
  const { services } = w.container;
  const onboarding = await services.onboarding.start(w.ctx, {
    supplierId,
    templateCode: "indirect-low-risk",
  });
  await services.onboarding.completeStep(w.ctx, onboarding.id, "legal-entity", "registry-extract.pdf");
  for (const code of ["tax-form", "coc"]) {
    await services.onboarding.receiveDocument(w.ctx, onboarding.id, code, `${code}.pdf`);
    await services.onboarding.verifyDocument(w.ctx, onboarding.id, code);
  }
  await services.onboarding.completeStep(w.ctx, onboarding.id, "tax-forms");
  for (const code of [
    "financial-stability",
    "subcontracting",
    "single-source",
    "data-access",
    "labour-practices",
    "geo-exposure",
  ]) {
    await services.onboarding.answerQuestion(w.ctx, onboarding.id, { code, value: "No concerns", riskFactor: 0.1 });
  }
  await services.onboarding.completeStep(w.ctx, onboarding.id, "risk-questionnaire");
  await services.onboarding.completeStep(w.ctx, onboarding.id, "bank-verification", "penny-test-passed");
  await services.onboarding.completeStep(w.ctx, onboarding.id, "code-of-conduct");
  await services.onboarding.submit(w.ctx, onboarding.id);
  await services.onboarding.decide(actor(w.ctx, "approver-1"), onboarding.id, "procurement", "approved");
  return services.supplier.get(w.ctx, supplierId);
}

/** Registers a supplier and takes it all the way to `active`. */
export async function activeSupplier(w: TestWorld, code = "ACME-PARTS"): Promise<Supplier> {
  const supplier = await tradingSupplier(w, code);
  return activate(w, supplier.id);
}

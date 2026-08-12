import { createTenantContext, money, type Email, type Money, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import type { Partner } from "../src/domain/partner.js";
import { addDays } from "../src/domain/protection.js";
import { createContainer, type ChannelContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";

export interface TestWorld {
  readonly container: ChannelContainer;
  readonly clock: FixedClock;
  /** Channel-ops context: approves, rejects, adjudicates. */
  readonly ctx: TenantContext;
  /** A partner-side actor, for the calls a partner makes themselves. */
  partnerCtx(user: string): TenantContext;
}

export const TENANT = "acme";

export function world(tenant = TENANT, user = "channel-ops"): TestWorld {
  const clock = new FixedClock("2026-01-01T00:00:00.000Z");
  const container = createContainer({ clock });
  return {
    container,
    clock,
    ctx: createTenantContext(tenant, user, ["prm.admin"]),
    partnerCtx: (partnerUser: string) => createTenantContext(tenant, partnerUser, ["prm.partner"]),
  };
}

export const usd = (amountMinor: number): Money => money(amountMinor, "USD");

export interface PartnerOverrides {
  readonly code?: string;
  readonly tier?: Partner["tier"];
  readonly type?: Partner["type"];
  readonly territories?: readonly string[];
  readonly productLines?: readonly string[];
  readonly currency?: string;
  readonly activate?: boolean;
}

/** Creates an active partner; the common precondition of every channel flow. */
export async function makePartner(w: TestWorld, overrides: PartnerOverrides = {}): Promise<Partner> {
  const code = overrides.code ?? "NORTHWIND";
  const partner = await w.container.services.partner.create(w.ctx, {
    code,
    name: `${code} Partner`,
    type: overrides.type ?? "reseller",
    tier: overrides.tier ?? "gold",
    territories: overrides.territories ?? ["NA", "EMEA"],
    productLines: overrides.productLines ?? ["network-security", "endpoint"],
    currency: overrides.currency ?? "USD",
    contact: { name: "Contact Person", email: `ops@${code.toLowerCase()}.example` as Email },
  });
  if (overrides.activate !== false) await w.container.services.partner.activate(w.ctx, partner.id);
  return partner;
}

export interface RegistrationOverrides {
  readonly customerName?: string;
  readonly domain?: string;
  readonly country?: string;
  readonly productLines?: readonly string[];
  readonly value?: Money;
  readonly description?: string;
  readonly closeInDays?: number;
}

const LONG_ENOUGH_DESCRIPTION =
  "Firewall estate refresh across the customer's manufacturing sites, incumbent contract expires soon.";

export async function makeRegistration(
  w: TestWorld,
  partner: Partner,
  overrides: RegistrationOverrides = {},
) {
  return w.container.services.registration.create(w.partnerCtx("partner-rep"), {
    partnerId: partner.id,
    endCustomer: {
      name: overrides.customerName ?? "Contoso Manufacturing",
      domain: overrides.domain ?? "contoso.com",
      country: overrides.country ?? "US",
    },
    productLines: overrides.productLines ?? ["network-security"],
    estimatedValue: overrides.value ?? usd(25_000_000),
    expectedCloseDate: addDays(w.clock.now(), overrides.closeInDays ?? 90),
    description: overrides.description ?? LONG_ENOUGH_DESCRIPTION,
  });
}

/** Registered, submitted and approved — a deal holding live protection. */
export async function makeApprovedRegistration(
  w: TestWorld,
  partner: Partner,
  overrides: RegistrationOverrides = {},
) {
  const registration = await makeRegistration(w, partner, overrides);
  const result = await w.container.services.registration.submit(w.partnerCtx("partner-rep"), registration.id);
  if (!result.autoApproved) {
    await w.container.services.registration.approve(w.ctx, registration.id);
  }
  return registration;
}

export function eventTypes(w: TestWorld, tenant = TENANT): string[] {
  return w.container.outbox.entries(tenant as never).map((event) => event.eventType);
}

export function eventsOfType(w: TestWorld, type: string, tenant = TENANT) {
  return w.container.outbox.ofType(type, tenant as never);
}

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
    const haystack = `${err.message ?? ""} ${err.details ? JSON.stringify(err.details) : ""}`;
    if (messageIncludes && !haystack.includes(messageIncludes)) {
      throw new Error(`Expected message to include "${messageIncludes}", got: ${haystack}`);
    }
    return;
  }
  throw new Error(`Expected rejection with code ${code}, but the promise resolved`);
}

export function expectThrows(fn: () => unknown, code: string, messageIncludes?: string): void {
  try {
    fn();
  } catch (error) {
    const err = error as { code?: string; message?: string; details?: unknown };
    if (err.code !== code) throw new Error(`Expected error code ${code}, got ${err.code}: ${err.message}`);
    const haystack = `${err.message ?? ""} ${err.details ? JSON.stringify(err.details) : ""}`;
    if (messageIncludes && !haystack.includes(messageIncludes)) {
      throw new Error(`Expected message to include "${messageIncludes}", got: ${haystack}`);
    }
    return;
  }
  throw new Error(`Expected a throw with code ${code}, but the call returned`);
}

export const asUlid = (value: string): Ulid => value as Ulid;

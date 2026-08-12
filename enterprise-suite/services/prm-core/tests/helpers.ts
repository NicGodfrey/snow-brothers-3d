import {
  createTenantContext,
  money,
  type IsoDateTime,
  type Money,
  type TenantContext,
  type Ulid,
} from "@enterprise-suite/shared-kernel";
import type { Partner } from "../src/domain/partner.js";
import { createContainer, type PrmContainer } from "../src/infrastructure/container.js";
import { FixedClock, SequentialTokenIssuer } from "../src/infrastructure/memory/stores.js";

export interface TestWorld {
  readonly container: PrmContainer;
  readonly clock: FixedClock;
  /** Channel-side operator: registers partners, approves, pays claims. */
  readonly ctx: TenantContext;
}

/** Fresh container with a deterministic clock and token issuer. */
export function world(tenant = "acme", user = "channel-manager"): TestWorld {
  const clock = new FixedClock("2026-01-05T00:00:00.000Z");
  const container = createContainer({ clock, tokens: new SequentialTokenIssuer() });
  return { container, clock, ctx: createTenantContext(tenant, user, ["prm.channel_manager"]) };
}

export const DAY_MS = 24 * 3600 * 1000;

/**
 * Partner-side caller. Requests and claims are filed by the partner and
 * approved by the channel, so tests need both identities to get past the
 * segregation-of-duties checks.
 */
export function partnerCtx(w: TestWorld, user = "ada@contoso.example"): TenantContext {
  return createTenantContext(w.ctx.tenantId, user, ["partner.portal_admin"]);
}

export function usd(major: number): Money {
  return money(Math.round(major * 100), "USD");
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
  throw new Error(`Expected rejection with code ${code}, but promise resolved`);
}

export interface OnboardOptions {
  readonly legalName?: string;
  readonly type?: Parameters<PrmContainer["services"]["partner"]["register"]>[1]["type"];
  readonly territories?: readonly string[];
  readonly countryCode?: string;
}

/** Registers a partner and walks it up to `approved` (contract, then activate). */
export async function approvedPartner(
  w: TestWorld,
  options: OnboardOptions = {},
): Promise<Partner> {
  const { partner } = w.container.services;
  const created = await partner.register(w.ctx, {
    legalName: options.legalName ?? "Contoso Solutions Ltd",
    type: options.type ?? "reseller",
    countryCode: options.countryCode ?? "GB",
    currency: "USD",
    territories: options.territories ?? ["GB"],
  });
  await partner.addAddress(w.ctx, created.id, {
    kind: "headquarters",
    line1: "1 Channel Way",
    city: "Reading",
    postalCode: "RG1 1AA",
    countryCode: options.countryCode ?? "GB",
  });
  await partner.addContact(w.ctx, created.id, {
    firstName: "Ada",
    lastName: "Nkemelu",
    email: `ada@${(options.legalName ?? "contoso").split(" ")[0]!.toLowerCase()}.example`,
    role: "primary",
  });
  await partner.submitApplication(w.ctx, created.id);
  await partner.startReview(w.ctx, created.id);
  return partner.approve(w.ctx, created.id, "Looks good");
}

/** Drafts, signs and activates a trading contract for `partnerId`. */
export async function activeContract(
  w: TestWorld,
  partnerId: Ulid,
  overrides: Partial<Parameters<PrmContainer["services"]["contract"]["draft"]>[1]> = {},
): Promise<Ulid> {
  const { contract } = w.container.services;
  const now = w.clock.now();
  const drafted = await contract.draft(w.ctx, {
    partnerId,
    type: "reseller",
    currency: "USD",
    effectiveFrom: now,
    effectiveTo: new Date(Date.parse(now) + 730 * DAY_MS).toISOString() as IsoDateTime,
    baseDiscountBps: 1500,
    mdfEligible: true,
    mdfAccrualBps: 200,
    ...overrides,
  });
  await contract.sendForSignature(w.ctx, drafted.id);
  await contract.sign(w.ctx, drafted.id, {
    party: "partner",
    signatoryName: "Ada Nkemelu",
    signatoryEmail: "ada@contoso.example",
  });
  await contract.sign(w.ctx, drafted.id, {
    party: "vendor",
    signatoryName: "Vendor Chief",
    signatoryEmail: "chief@vendor.example",
  });
  await contract.activate(w.ctx, drafted.id);
  return drafted.id;
}

/** Approved partner + active contract + activation: ready to trade. */
export async function activePartner(w: TestWorld, options: OnboardOptions = {}): Promise<Partner> {
  const approved = await approvedPartner(w, options);
  await activeContract(w, approved.id);
  return w.container.services.partner.activate(w.ctx, approved.id);
}

/** Invites a portal user and accepts the invite. */
export async function portalUser(
  w: TestWorld,
  partnerId: Ulid,
  email: string,
  roles: Parameters<PrmContainer["services"]["portal"]["invite"]>[1]["roles"] = ["portal_admin"],
): Promise<Ulid> {
  const user = await w.container.services.portal.invite(w.ctx, {
    partnerId,
    email,
    firstName: email.split("@")[0]!,
    lastName: "Tester",
    roles,
  });
  await w.container.services.portal.acceptInvite(w.ctx, user.id);
  return user.id;
}

/** Event types published for a tenant, in order. */
export function eventTypes(w: TestWorld): string[] {
  return w.container.outbox.entries(w.ctx.tenantId).map((e) => e.eventType);
}

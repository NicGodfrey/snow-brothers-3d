import { tenantId as toTenantId, type TenantId, type Ulid } from "@enterprise-suite/shared-kernel";
import type { Principal } from "../src/application/principal.js";
import { userSubject } from "../src/domain/subject.js";
import { seedDemoTenant, SEED_PASSWORD, type SeedRefs } from "../src/fixtures/seed.js";
import { createIdentityModule, type IdentityModule } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import {
  Pbkdf2PasswordHasher,
  SequentialTokenGenerator,
} from "../src/infrastructure/crypto/hashing.js";

export interface TestContext {
  readonly module: IdentityModule;
  readonly clock: FixedClock;
}

/**
 * A module wired for tests: deterministic clock and token generator, and a deliberately
 * weak KDF so a suite that activates a dozen users still runs in milliseconds.
 */
export function makeModule(start = "2026-03-01T09:00:00.000Z"): TestContext {
  const clock = new FixedClock(start);
  const module = createIdentityModule({
    clock,
    passwordHasher: new Pbkdf2PasswordHasher(1000),
    tokens: new SequentialTokenGenerator(),
  });
  return { module, clock };
}

export interface SeededContext extends TestContext {
  readonly refs: SeedRefs;
  readonly tenantId: TenantId;
}

export function seeded(start?: string): SeededContext {
  const { module, clock } = makeModule(start);
  const refs = seedDemoTenant(module);
  return { module, clock, refs, tenantId: refs.tenantId };
}

/** A bare, activated tenant with the system roles installed and no users. */
export function emptyTenant(module: IdentityModule, slug = "acme"): TenantId {
  const tenant = module.tenants.provision({ slug, name: `${slug} Inc`, activate: true });
  module.installSystemRoles(tenant.tenantId);
  return tenant.tenantId;
}

export function principalFor(tenantId: TenantId, userId: Ulid, displayName = "test"): Principal {
  return {
    tenantId,
    subject: userSubject(userId),
    displayName,
    amr: ["password"],
    mfaSatisfied: false,
  };
}

export function createActiveUser(
  module: IdentityModule,
  tenantId: TenantId,
  email: string,
  displayName = "Test User",
): Ulid {
  const user = module.users.invite(tenantId, { email, displayName });
  module.users.activate(tenantId, { userId: user.id, password: SEED_PASSWORD });
  return user.id;
}

export { SEED_PASSWORD, toTenantId };

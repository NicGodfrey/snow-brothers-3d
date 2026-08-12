import type { TenantProfile, UserProfile } from "../../domain/session.js";

/**
 * Mock identity directory.
 *
 * Stands in for `identity-access` until it is wired up: two tenants with
 * different entitlements and a handful of users whose roles differ per tenant,
 * which is exactly what the shell's permission filtering needs to be exercised.
 */

export const TENANTS: readonly TenantProfile[] = [
  {
    tenantId: "acme",
    name: "Acme Manufacturing",
    entitlements: ["sales", "marketing", "inventory", "srm", "prm", "finance"],
    defaultLocale: "en-US",
    defaultCurrency: "USD",
    featureFlags: { commandPalette: true, mdfWorkflow: true, darkMode: true },
  },
  {
    tenantId: "globex",
    name: "Globex Distribution",
    // No PRM subscription: the module must disappear, not merely 403.
    entitlements: ["sales", "inventory", "srm", "finance"],
    defaultLocale: "en-GB",
    defaultCurrency: "EUR",
    featureFlags: { commandPalette: true, mdfWorkflow: false, darkMode: false },
  },
];

export const USERS: readonly UserProfile[] = [
  {
    userId: "u-avery",
    displayName: "Avery Chen",
    email: "avery.chen@acme.test",
    memberships: {
      acme: ["sales-manager", "channel-manager"],
      globex: ["viewer"],
    },
  },
  {
    userId: "u-jordan",
    displayName: "Jordan Blake",
    email: "jordan.blake@acme.test",
    memberships: { acme: ["buyer", "warehouse-clerk"] },
  },
  {
    userId: "u-rin",
    displayName: "Rin Watanabe",
    email: "rin.watanabe@acme.test",
    memberships: { acme: ["controller"], globex: ["accountant"] },
  },
  {
    userId: "u-sam",
    displayName: "Sam Okafor",
    email: "sam.okafor@acme.test",
    memberships: { acme: ["marketing-manager"] },
  },
  {
    userId: "u-admin",
    displayName: "Dana Reyes",
    email: "dana.reyes@acme.test",
    memberships: { acme: ["tenant-admin"], globex: ["tenant-admin"] },
  },
];

export class Directory {
  private readonly tenants = new Map<string, TenantProfile>();
  private readonly usersById = new Map<string, UserProfile>();
  private readonly usersByEmail = new Map<string, UserProfile>();

  constructor(
    tenants: readonly TenantProfile[] = TENANTS,
    users: readonly UserProfile[] = USERS,
  ) {
    for (const tenant of tenants) this.tenants.set(tenant.tenantId, tenant);
    for (const user of users) {
      this.usersById.set(user.userId, user);
      this.usersByEmail.set(user.email.toLowerCase(), user);
    }
  }

  tenant(tenantId: string): TenantProfile | undefined {
    return this.tenants.get(tenantId);
  }

  user(userId: string): UserProfile | undefined {
    return this.usersById.get(userId);
  }

  userByEmail(email: string): UserProfile | undefined {
    return this.usersByEmail.get(email.trim().toLowerCase());
  }

  listTenants(): readonly TenantProfile[] {
    return [...this.tenants.values()];
  }

  listUsers(): readonly UserProfile[] {
    return [...this.usersById.values()];
  }

  /** Tenants the user is a member of *and* that exist in the directory. */
  tenantsFor(user: UserProfile): readonly TenantProfile[] {
    return Object.keys(user.memberships)
      .map((id) => this.tenants.get(id))
      .filter((t): t is TenantProfile => t !== undefined);
  }
}

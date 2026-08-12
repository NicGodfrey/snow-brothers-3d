import { tenantId as toTenantId, type TenantId } from "@enterprise-suite/shared-kernel";
import type { CommandContext } from "../src/application/ports.js";
import { SequentialSecretGenerator } from "../src/infrastructure/crypto.js";
import { createContainer, type AdminContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory-repositories.js";
import { RecordingWebhookSender } from "../src/infrastructure/webhook-sender.js";

/**
 * Shared fixture: a container whose clock, secrets and webhook transport are
 * all deterministic, so a test can assert on exact tokens, timestamps and
 * signatures rather than on shapes.
 */

export const TEST_TENANT = "northwind";

export interface Harness {
  readonly container: AdminContainer;
  readonly clock: FixedClock;
  readonly sender: RecordingWebhookSender;
  readonly secrets: SequentialSecretGenerator;
  readonly tenantId: TenantId;
  readonly platform: CommandContext;
  readonly admin: CommandContext;
}

export function harness(
  options: { tenantKey?: string; bridgeEventsToWebhooks?: boolean } = {},
): Harness {
  const tenantKey = options.tenantKey ?? TEST_TENANT;
  const clock = new FixedClock("2026-03-01T09:00:00.000Z");
  const sender = new RecordingWebhookSender(clock);
  const secrets = new SequentialSecretGenerator();
  const container = createContainer({
    clock,
    sender,
    secrets,
    bridgeEventsToWebhooks: options.bridgeEventsToWebhooks,
  });

  return {
    container,
    clock,
    sender,
    secrets,
    tenantId: toTenantId(tenantKey),
    platform: {
      tenantId: toTenantId(tenantKey),
      actor: "ops@enterprise-suite.example",
      roles: ["platform-admin"],
      requestId: "req_test_platform",
    },
    admin: {
      tenantId: toTenantId(tenantKey),
      actor: "admin@northwind.example",
      roles: ["tenant-admin"],
      requestId: "req_test_admin",
      sourceIp: "203.0.113.9",
    },
  };
}

/** Provisions and activates the tenant, which most tests need before anything. */
export async function activeTenant(h: Harness, tenantKey = TEST_TENANT): Promise<void> {
  await h.container.services.tenant.provision(h.platform, {
    key: tenantKey,
    name: "Northwind Manufacturing",
    plan: "standard",
  });
  await h.container.services.tenant.activate(h.platform, tenantKey);
}

/** Invites a user and immediately redeems the invitation. */
export async function activeUser(
  h: Harness,
  email: string,
  roles: readonly string[] = ["tenant-operator"],
): Promise<void> {
  const { user } = h.container.services;
  const invited = await user.invite(h.admin, {
    email,
    displayName: email.split("@")[0]!,
    roles: [...roles],
  });
  await user.acceptInvite(h.admin, email, invited.inviteToken);
}

/** Asserts that `action` rejects, and returns the error for further checks. */
export async function rejects(action: () => Promise<unknown>): Promise<Error> {
  try {
    await action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to be rejected, but it succeeded");
}

export function throwsSync(action: () => unknown): Error {
  try {
    action();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to throw, but it returned");
}

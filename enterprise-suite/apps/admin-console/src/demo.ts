import { brand, tenantId as toTenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import type { CommandContext } from "./application/ports.js";
import { createContainer } from "./infrastructure/container.js";
import { SystemClock } from "./infrastructure/memory-repositories.js";
import { RecordingWebhookSender } from "./infrastructure/webhook-sender.js";
import { seedDemoData } from "./infrastructure/seed.js";

/**
 * Walks the console's own workflows end to end and prints what happened, so the
 * behaviour can be inspected without a browser or a running server.
 */
async function main(): Promise<void> {
  const clock = new SystemClock();
  const sender = new RecordingWebhookSender(clock);
  const container = createContainer({ clock, sender });
  const seeded = await seedDemoData(container);
  const { tenant, user, role, referenceData, webhook, featureFlag, audit } = container.services;

  const ctx: CommandContext = {
    tenantId: toTenantId(seeded.tenantKey),
    actor: seeded.adminEmail,
    roles: ["tenant-admin"],
    requestId: "req_demo",
  };

  heading("Tenant");
  const record = tenant.require(seeded.tenantKey);
  console.log(`${record.name} (${record.key}) — ${record.status}, plan ${record.plan}`);
  for (const entry of tenant.quotaReport(seeded.tenantKey).entries) {
    console.log(`  ${entry.resource.padEnd(16)} ${entry.used}/${entry.limit} (${entry.percent}%)`);
  }

  heading("Roles");
  for (const each of role.list(ctx.tenantId)) {
    const resolved = role.effectivePermissions(ctx.tenantId, each.code);
    console.log(
      `  ${each.code.padEnd(22)} ${each.isSystem ? "system" : "tenant"} ` +
        `inherits=${each.inheritsFrom ?? "—"} permissions=${resolved.length}`,
    );
  }

  heading("Users");
  for (const each of user.list(ctx.tenantId)) {
    console.log(`  ${each.email.padEnd(26)} ${each.status.padEnd(10)} [${each.roles.join(", ")}]`);
  }

  heading("Last administrator is protected");
  await expectFailure(async () => {
    for (const each of user.list(ctx.tenantId, { role: "tenant-admin" })) {
      await user.suspend(ctx, each.email, "demo");
    }
  });

  heading("Reference data");
  const holds = referenceData.require(ctx.tenantId, "order-hold-reason");
  console.log(`  ${holds.code} is ${holds.status} at revision ${holds.revision}`);
  const resolved = referenceData.resolve(ctx.tenantId, "order-hold-reason", {
    at: brand<string, "IsoDateTime">("2026-06-01T00:00:00.000Z") as IsoDateTime,
  });
  console.log(`  active on 2026-06-01: ${resolved.map((entry) => entry.code).join(", ")}`);

  heading("Feature flag rollout");
  for (const subject of ["ada@northwind.example", "raj@northwind.example", "mei@northwind.example"]) {
    const decision = featureFlag.evaluate(ctx.tenantId, "new-order-workspace", {
      subject,
      attributes: { site: subject.startsWith("mei") ? "derby" : "leeds" },
    });
    console.log(`  ${subject.padEnd(26)} → ${String(decision.value).padEnd(6)} (${decision.reason})`);
  }

  heading("Webhook delivery");
  await featureFlag.toggle(ctx, "mrp-parallel-run", true);
  const report = await webhook.drain(50);
  console.log(`  attempted=${report.attempted} delivered=${report.delivered} failed=${report.failed}`);
  for (const call of sender.sent.slice(0, 3)) {
    const signature = call.headers["x-signature"] ?? call.headers["x-webhook-signature"] ?? "";
    console.log(`  → ${call.url} sig=${signature.slice(0, 16)}…`);
  }

  heading("Audit trail (most recent 8)");
  const entries = audit.query(ctx.tenantId, {}, { page: 1, pageSize: 8 });
  for (const entry of entries.items) {
    console.log(`  ${entry.at}  ${entry.actor.padEnd(24)} ${entry.action.padEnd(26)} ${entry.outcome}`);
  }
  console.log(`  ${entries.total} entries recorded in total`);

  container.dispose();
}

function heading(title: string): void {
  console.log(`\n=== ${title} ${"=".repeat(Math.max(0, 60 - title.length))}`);
}

async function expectFailure(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    console.log("  (no failure — unexpected)");
  } catch (error) {
    console.log(`  rejected: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

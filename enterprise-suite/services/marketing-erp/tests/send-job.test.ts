import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTenantContext } from "@enterprise-suite/shared-kernel";
import type { Audience } from "../src/domain/audience.js";
import type { Campaign } from "../src/domain/campaign.js";
import type { Channel } from "../src/domain/channel.js";
import type { ContentAsset } from "../src/domain/content-asset.js";
import { MarketingEvents } from "../src/domain/events.js";
import { FixedClock } from "../src/infrastructure/clock.js";
import { createMarketingModule, type MarketingModule } from "../src/infrastructure/container.js";
import { ScriptedMessageSender, SimulatedMessageSender } from "../src/infrastructure/simulated-sender.js";

const ctx = createTenantContext("t_send", "user_test", ["admin", "marketing_manager"]);

interface Fixture {
  module: MarketingModule;
  clock: FixedClock;
  sender: ScriptedMessageSender;
  campaign: Campaign;
  channel: Channel;
  content: ContentAsset;
  audience: Audience;
}

function setup(): Fixture {
  const clock = new FixedClock("2026-08-03T09:00:00.000Z");
  const sender = new ScriptedMessageSender();
  const module = createMarketingModule({ clock, sender });
  const { services } = module;

  const channel = services.channels.create(ctx, {
    name: "Email",
    code: "email",
    kind: "email",
    costModel: "flat",
    unitCostMinor: 0,
    currency: "USD",
  });
  const campaign = services.campaigns.create(ctx, {
    name: "Newsletter",
    code: "newsletter",
    objective: "retention",
  });
  services.campaigns.attachChannel(ctx, campaign.id, channel.id);
  services.campaigns.activate(ctx, campaign.id);

  services.leads.capture(ctx, {
    email: "opted-in@example.com",
    source: "web_form",
    firstName: "Opted",
    consentEmail: true,
  });
  services.leads.capture(ctx, {
    email: "no-consent@example.com",
    source: "web_form",
    consentEmail: false,
  });
  services.leads.capture(ctx, {
    email: "engaged@example.com",
    source: "web_form",
    firstName: "Engaged",
    consentEmail: true,
  });

  const content = services.content.create(ctx, {
    title: "Weekly digest",
    slug: "weekly-digest",
    kind: "email_template",
    subject: "Hello {{firstName}}",
    body: "News for {{company}}",
  });
  services.content.submitForReview(ctx, content.id);
  services.content.approve(ctx, content.id);

  const segment = services.segments.createDynamic(ctx, {
    name: "Everyone",
    rule: { kind: "condition", field: "email", op: "exists" },
  });
  const audience = services.audiences.build(ctx, {
    segmentId: segment.id,
    channelKind: "email",
    campaignId: campaign.id,
  });
  return { module, clock, sender, campaign, channel, content, audience };
}

describe("Audience build", () => {
  it("suppresses leads without channel consent", () => {
    const { audience, module } = setup();
    assert.equal(audience.size, 2);
    assert.equal(audience.suppressed.length, 1);
    assert.equal(audience.suppressed[0]!.reason, "no_consent");
    const suppressedLead = module.repos.leads.getOrThrow(ctx.tenantId, audience.suppressed[0]!.leadId);
    assert.equal(suppressedLead.email, "no-consent@example.com");
  });
});

describe("SendJobService", () => {
  it("enforces content/channel/audience compatibility", () => {
    const fixture = setup();
    const { services } = fixture.module;
    const smsChannel = services.channels.create(ctx, {
      name: "SMS",
      code: "sms",
      kind: "sms",
      costModel: "flat",
      unitCostMinor: 0,
      currency: "USD",
    });
    services.campaigns.attachChannel(ctx, fixture.campaign.id, smsChannel.id);
    assert.throws(
      () =>
        services.sendJobs.create(ctx, {
          campaignId: fixture.campaign.id,
          channelId: smsChannel.id,
          audienceId: fixture.audience.id, // built for email
          contentAssetId: fixture.content.id,
        }),
      /built for email/,
    );
  });

  it("refuses unapproved content", () => {
    const fixture = setup();
    const { services } = fixture.module;
    const draft = services.content.create(ctx, {
      title: "Draft",
      slug: "draft-mail",
      kind: "email_template",
      subject: "s",
      body: "b",
    });
    assert.throws(
      () =>
        services.sendJobs.create(ctx, {
          campaignId: fixture.campaign.id,
          channelId: fixture.channel.id,
          audienceId: fixture.audience.id,
          contentAssetId: draft.id,
        }),
      /approved/,
    );
  });

  it("runs a send: skips, outcomes, engagement activities and touchpoints", () => {
    const fixture = setup();
    const { services, repos, outbox } = fixture.module;

    // Script per-recipient outcomes.
    fixture.sender.script("opted-in@example.com", {
      delivered: true,
      opened: true,
      clicked: false,
      unsubscribed: false,
    });
    fixture.sender.script("engaged@example.com", {
      delivered: true,
      opened: true,
      clicked: true,
      unsubscribed: true,
    });

    const job = services.sendJobs.create(ctx, {
      campaignId: fixture.campaign.id,
      channelId: fixture.channel.id,
      audienceId: fixture.audience.id,
      contentAssetId: fixture.content.id,
    });
    services.sendJobs.queue(ctx, job.id);
    const { stats } = services.sendJobs.run(ctx, job.id);

    assert.equal(stats.total, 2);
    assert.equal(stats.delivered, 2);
    assert.equal(stats.opened, 2);
    assert.equal(stats.clicked, 1);
    assert.equal(stats.unsubscribed, 1);
    assert.equal(stats.openRate, 1);
    assert.equal(stats.clickRate, 0.5);

    // Engagement became lead activities + touchpoints.
    const engaged = repos.leads.findByEmail(ctx.tenantId, "engaged@example.com")!;
    const activityTypes = engaged.activities.map((a) => a.type);
    assert.ok(activityTypes.includes("email_open"));
    assert.ok(activityTypes.includes("email_click"));
    assert.ok(!engaged.canReceive("email"), "unsubscribe revoked consent");

    const touches = repos.touchpoints.listByLead(ctx.tenantId, engaged.id);
    assert.equal(touches.filter((t) => t.touchType === "email_click").length, 1);
    assert.equal(touches.filter((t) => t.touchType === "email_open").length, 1);
    assert.ok(touches.every((t) => t.campaignId === fixture.campaign.id));

    const completed = outbox.ofType(MarketingEvents.SendJobCompleted);
    assert.equal(completed.length, 1);
  });

  it("cannot run against a paused campaign", () => {
    const fixture = setup();
    const { services } = fixture.module;
    const job = services.sendJobs.create(ctx, {
      campaignId: fixture.campaign.id,
      channelId: fixture.channel.id,
      audienceId: fixture.audience.id,
      contentAssetId: fixture.content.id,
    });
    services.sendJobs.queue(ctx, job.id);
    services.campaigns.pause(ctx, fixture.campaign.id);
    assert.throws(() => services.sendJobs.run(ctx, job.id), /must be active/);
  });

  it("scheduled jobs refuse to start early", () => {
    const fixture = setup();
    const { services } = fixture.module;
    const job = services.sendJobs.create(ctx, {
      campaignId: fixture.campaign.id,
      channelId: fixture.channel.id,
      audienceId: fixture.audience.id,
      contentAssetId: fixture.content.id,
    });
    services.sendJobs.queue(ctx, job.id, "2026-08-04T09:00:00.000Z");
    assert.throws(() => services.sendJobs.run(ctx, job.id), /scheduled for/);
    fixture.clock.advanceDays(1);
    const { stats } = services.sendJobs.run(ctx, job.id);
    assert.equal(stats.total, 2);
  });
});

describe("SimulatedMessageSender", () => {
  it("is deterministic for the same job and recipient", () => {
    const sender = new SimulatedMessageSender("seed-a");
    const message = {
      jobId: "job_1" as never,
      channel: "email" as const,
      to: "someone@example.com",
      body: "hi",
    };
    assert.deepEqual(sender.send(message), sender.send(message));
  });

  it("produces realistic aggregate rates over many sends", () => {
    const sender = new SimulatedMessageSender("seed-b");
    let delivered = 0;
    const n = 2_000;
    for (let i = 0; i < n; i++) {
      const outcome = sender.send({
        jobId: "job_bulk" as never,
        channel: "email",
        to: `user${i}@example.com`,
        body: "hi",
      });
      if (outcome.delivered) delivered += 1;
    }
    const rate = delivered / n;
    assert.ok(rate > 0.93 && rate < 0.99, `delivery rate ${rate} outside expected band`);
  });
});

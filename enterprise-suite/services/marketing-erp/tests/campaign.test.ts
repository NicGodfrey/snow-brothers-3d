import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, newId, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { Campaign } from "../src/domain/campaign.js";
import { MarketingEvents } from "../src/domain/events.js";

const tenant = tenantId("t_campaigns");
const at = (iso: string): IsoDateTime => brand<string, "IsoDateTime">(iso);

function draft(): Campaign {
  return Campaign.create({
    tenantId: tenant,
    name: "Fall Launch",
    code: "fall-launch",
    objective: "acquisition",
  });
}

describe("Campaign lifecycle", () => {
  it("creates in draft with a created event", () => {
    const campaign = draft();
    assert.equal(campaign.status, "draft");
    const events = campaign.pullEvents();
    assert.equal(events[0]!.eventType, MarketingEvents.CampaignCreated);
  });

  it("validates code format and date window", () => {
    assert.throws(
      () => Campaign.create({ tenantId: tenant, name: "Bad", code: "Bad Code!", objective: "awareness" }),
      /code must match/,
    );
    assert.throws(
      () =>
        Campaign.create({
          tenantId: tenant,
          name: "Bad window",
          code: "bad-window",
          objective: "awareness",
          startsAt: at("2026-09-01T00:00:00.000Z"),
          endsAt: at("2026-08-01T00:00:00.000Z"),
        }),
      /endsAt/,
    );
  });

  it("cannot activate without channels", () => {
    const campaign = draft();
    assert.throws(() => campaign.activate(), /at least one channel/);
    assert.equal(campaign.status, "draft", "failed guard must not change state");
  });

  it("walks draft -> scheduled -> active -> paused -> active -> completed -> archived", () => {
    const campaign = draft();
    campaign.attachChannel(newId("channel"));
    campaign.schedule(at("2026-09-01T00:00:00.000Z"), at("2026-10-01T00:00:00.000Z"));
    assert.equal(campaign.status, "scheduled");
    campaign.activate();
    assert.equal(campaign.status, "active");
    campaign.pause();
    campaign.activate(); // resume
    campaign.complete();
    campaign.archive();
    assert.equal(campaign.status, "archived");

    const types = campaign.pullEvents().map((e) => e.eventType);
    assert.ok(types.includes(MarketingEvents.CampaignResumed));
    assert.ok(types.includes(MarketingEvents.CampaignCompleted));
  });

  it("rejects illegal transitions", () => {
    const campaign = draft();
    assert.throws(() => campaign.pause(), /cannot transition/);
    campaign.attachChannel(newId("channel"));
    campaign.activate();
    assert.throws(() => campaign.archive(), /cannot transition/);
  });
});

describe("Campaign channels", () => {
  it("attaches and detaches channels with duplicate protection", () => {
    const campaign = draft();
    const channelId = newId("channel");
    campaign.attachChannel(channelId);
    assert.throws(() => campaign.attachChannel(channelId), /already attached/);
    campaign.detachChannel(channelId);
    assert.equal(campaign.channelIds.length, 0);
    assert.throws(() => campaign.detachChannel(channelId), /not attached/);
  });

  it("an active campaign keeps at least one channel", () => {
    const campaign = draft();
    const only = newId("channel");
    campaign.attachChannel(only);
    campaign.activate();
    assert.throws(() => campaign.detachChannel(only), /at least one channel/);
  });
});

describe("Campaign window", () => {
  it("coversInstant honors open and closed bounds", () => {
    const campaign = Campaign.create({
      tenantId: tenant,
      name: "Windowed",
      code: "windowed",
      objective: "retention",
      startsAt: at("2026-09-01T00:00:00.000Z"),
      endsAt: at("2026-09-30T00:00:00.000Z"),
    });
    assert.ok(!campaign.coversInstant(at("2026-08-31T00:00:00.000Z")));
    assert.ok(campaign.coversInstant(at("2026-09-15T00:00:00.000Z")));
    assert.ok(!campaign.coversInstant(at("2026-10-01T00:00:00.000Z")));

    const open = draft();
    assert.ok(open.coversInstant(at("2020-01-01T00:00:00.000Z")));
  });
});

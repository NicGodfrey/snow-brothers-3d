import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createMarketingModule } from "../src/infrastructure/container.js";
import { createMarketingServer } from "../src/http/server.js";

const HEADERS = {
  "content-type": "application/json",
  "x-tenant-id": "t_http",
  "x-user-id": "user_http",
  "x-roles": "admin,marketing_manager",
};

let server: Server;
let baseUrl: string;

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = HEADERS,
): Promise<{ status: number; json: any; headers: Headers }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  return {
    status: response.status,
    json: text ? JSON.parse(text) : undefined,
    headers: response.headers,
  };
}

before(async () => {
  const module = createMarketingModule();
  server = createMarketingServer(module);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("HTTP API", () => {
  it("serves health without identity headers", async () => {
    const res = await call("GET", "/health", undefined, {});
    assert.equal(res.status, 200);
    assert.equal(res.json.status, "ok");
  });

  it("rejects requests without tenant identity", async () => {
    const res = await call("GET", "/campaigns", undefined, { "content-type": "application/json" });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "MISSING_TENANT");
  });

  it("404s unknown routes with a JSON body", async () => {
    const res = await call("GET", "/no-such-route");
    assert.equal(res.status, 404);
    assert.equal(res.json.error, "NOT_FOUND");
  });

  it("validates request bodies with field-level errors", async () => {
    const res = await call("POST", "/channels", { name: "Email" });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, "INVALID_FIELD");
    assert.equal(res.json.details.field, "code");
  });

  it("drives a full campaign flow over HTTP", async () => {
    // Channel + campaign
    const channel = await call("POST", "/channels", {
      name: "Email",
      code: "email",
      kind: "email",
      costModel: "flat",
      unitCostMinor: 0,
      currency: "USD",
    });
    assert.equal(channel.status, 201);

    const campaign = await call("POST", "/campaigns", {
      name: "HTTP Launch",
      code: "http-launch",
      objective: "acquisition",
      utmDefaults: { source: "newsletter", medium: "email" },
    });
    assert.equal(campaign.status, 201);
    assert.equal(campaign.json.status, "draft");

    await call("POST", `/campaigns/${campaign.json.id}/channels`, { channelId: channel.json.id });
    const activated = await call("POST", `/campaigns/${campaign.json.id}/activate`);
    assert.equal(activated.json.status, "active");

    // Duplicate code conflicts
    const duplicate = await call("POST", "/campaigns", {
      name: "Dup",
      code: "http-launch",
      objective: "awareness",
    });
    assert.equal(duplicate.status, 409);

    // Budget + spend
    const budget = await call("POST", "/budgets", {
      campaignId: campaign.json.id,
      totalMinor: 1_000_000,
      currency: "USD",
    });
    assert.equal(budget.status, 201);
    const spend = await call("POST", `/budgets/${budget.json.id}/spend`, {
      amountMinor: 250_000,
      currency: "USD",
      category: "media",
    });
    assert.equal(spend.status, 201);

    // Leads
    const lead = await call("POST", "/leads", {
      email: "http-buyer@example.com",
      source: "web_form",
      firstName: "Hattie",
      jobTitle: "VP Growth",
      companySize: 400,
      industry: "saas",
      company: "HTTP Co",
      consentEmail: true,
      utm: { source: "google", medium: "cpc", campaign: "http-launch" },
    });
    assert.equal(lead.status, 201);
    assert.equal(lead.json.stage, "subscriber");

    for (const type of ["webinar_attend", "demo_request", "pricing_view"]) {
      const activity = await call("POST", `/leads/${lead.json.id}/activities`, {
        type,
        campaignId: campaign.json.id,
      });
      assert.equal(activity.status, 201);
    }

    const rescored = await call("POST", `/leads/${lead.json.id}/rescore`);
    assert.equal(rescored.status, 200);
    assert.equal(rescored.json.stage, "sql");
    assert.ok(rescored.json.score >= 70);

    // Segment + audience + content + send
    const segment = await call("POST", "/segments", {
      type: "dynamic",
      name: "Consented",
      rule: { kind: "condition", field: "consentEmail", op: "eq", value: true },
    });
    assert.equal(segment.status, 201);
    const preview = await call("GET", `/segments/${segment.json.id}/preview`);
    assert.equal(preview.json.matchCount, 1);

    const audience = await call("POST", "/audiences", {
      segmentId: segment.json.id,
      channelKind: "email",
      campaignId: campaign.json.id,
    });
    assert.equal(audience.status, 201);
    assert.equal(audience.json.memberLeadIds.length, 1);

    const content = await call("POST", "/content-assets", {
      title: "HTTP mail",
      slug: "http-mail",
      kind: "email_template",
      subject: "Hi {{firstName}}",
      body: "Hello {{firstName}} from {{company}}",
    });
    await call("POST", `/content-assets/${content.json.id}/submit`);
    const approved = await call("POST", `/content-assets/${content.json.id}/approve`);
    assert.equal(approved.json.status, "approved");

    const job = await call("POST", "/send-jobs", {
      campaignId: campaign.json.id,
      channelId: channel.json.id,
      audienceId: audience.json.id,
      contentAssetId: content.json.id,
    });
    assert.equal(job.status, 201);
    await call("POST", `/send-jobs/${job.json.id}/queue`, {});
    const run = await call("POST", `/send-jobs/${job.json.id}/run`);
    assert.equal(run.status, 200);
    assert.equal(run.json.stats.total, 1);

    // Handoff
    const handoff = await call("POST", `/leads/${lead.json.id}/handoff`, {
      estimatedValueMinor: 900_000,
      currency: "USD",
      attributionModel: "linear",
    });
    assert.equal(handoff.status, 201);
    assert.equal(handoff.json.kind, "marketing.lead-opportunity-handoff");
    assert.equal(handoff.json.sourceCampaign.code, "http-launch");

    // Attribution + ROI
    const report = await call("GET", "/attribution/report?model=first_touch");
    assert.equal(report.json.totalRevenueMinor, 900_000);
    const roi = await call("GET", `/campaigns/${campaign.json.id}/roi?model=linear`);
    assert.equal(roi.json.spendMinor, 250_000);
    assert.ok(roi.json.attributedRevenueMinor > 0);

    const funnel = await call("GET", "/funnel");
    assert.equal(funnel.json.countsByStage.opportunity, 1);
  });

  it("tenants are isolated from each other", async () => {
    const lead = await call("POST", "/leads", { email: "iso@example.com", source: "import" });
    assert.equal(lead.status, 201);
    const otherTenant = await call("GET", `/leads/${lead.json.id}`, undefined, {
      ...HEADERS,
      "x-tenant-id": "t_other",
    });
    assert.equal(otherTenant.status, 404);
  });

  it("serves tracked link redirects", async () => {
    const link = await call("POST", "/tracked-links", {
      destinationUrl: "https://acme.example/landing",
      utm: { source: "twitter", medium: "social", campaign: "http-launch" },
      shortCode: "tw1234",
    });
    assert.equal(link.status, 201);
    const redirect = await call("GET", "/t/tw1234");
    assert.equal(redirect.status, 302);
    const location = redirect.headers.get("location")!;
    assert.ok(location.startsWith("https://acme.example/landing"));
    assert.ok(location.includes("utm_campaign=http-launch"));
  });

  it("exposes stateless utm utilities", async () => {
    const parse = await call("POST", "/utm/parse", {
      url: "https://x.example/?utm_source=a&utm_medium=b&utm_campaign=c",
    });
    assert.deepEqual(parse.json, { source: "a", medium: "b", campaign: "c" });
    const build = await call("POST", "/utm/build", {
      baseUrl: "https://x.example/page",
      utm: { source: "a", medium: "b", campaign: "c" },
    });
    assert.ok(build.json.url.includes("utm_source=a"));
  });

  it("maps forbidden actions to 403", async () => {
    const content = await call("POST", "/content-assets", {
      title: "Needs approval",
      slug: "needs-approval",
      kind: "sms_template",
      body: "hi {{firstName}}",
    });
    await call("POST", `/content-assets/${content.json.id}/submit`);
    const denied = await call("POST", `/content-assets/${content.json.id}/approve`, undefined, {
      ...HEADERS,
      "x-roles": "viewer",
    });
    assert.equal(denied.status, 403);
  });
});

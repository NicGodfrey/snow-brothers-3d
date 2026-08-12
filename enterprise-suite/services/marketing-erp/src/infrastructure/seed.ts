import { createTenantContext, type TenantContext, type Ulid } from "@enterprise-suite/shared-kernel";
import { FixedClock } from "./clock.js";
import { createMarketingModule, type MarketingModule } from "./container.js";
import { ScriptedMessageSender } from "./simulated-sender.js";

export interface SeedResult {
  readonly ctx: TenantContext;
  readonly channelIds: Record<"paidSearch" | "email" | "sms" | "webinar" | "organicSocial", Ulid>;
  readonly campaignIds: Record<"q3Launch" | "newsletter", Ulid>;
  readonly budgetIds: Record<"q3Launch" | "newsletter", Ulid>;
  readonly leadIds: Record<"alice" | "bob" | "carol" | "dave" | "erin" | "frank", Ulid>;
  readonly segmentId: Ulid;
  readonly audienceId: Ulid;
  readonly sendJobId: Ulid;
  readonly trackedLinkCode: string;
}

/**
 * Builds a coherent demo tenant: channels, two campaigns with budgets and
 * spend, an approved email template, six leads with multi-touch journeys,
 * a segment + audience, one executed email send, scoring, and two
 * lead -> opportunity handoffs (one closed-won). Deterministic thanks to the
 * fixed clock and seeded delivery simulation.
 */
export function seedDemoData(module: MarketingModule, clock: FixedClock): SeedResult {
  const { services } = module;
  const ctx = createTenantContext("tenant_acme", "user_demo", ["admin", "marketing_manager"]);

  // --- Channels ------------------------------------------------------------
  const paidSearch = services.channels.create(ctx, {
    name: "Google Ads",
    code: "google-ads",
    kind: "paid_search",
    costModel: "cpc",
    unitCostMinor: 250,
    currency: "USD",
  });
  const email = services.channels.create(ctx, {
    name: "Marketing Email",
    code: "mkt-email",
    kind: "email",
    costModel: "flat",
    unitCostMinor: 0,
    currency: "USD",
  });
  const sms = services.channels.create(ctx, {
    name: "Transactional SMS",
    code: "mkt-sms",
    kind: "sms",
    costModel: "flat",
    unitCostMinor: 0,
    currency: "USD",
  });
  const webinar = services.channels.create(ctx, {
    name: "Product Webinars",
    code: "webinars",
    kind: "webinar",
    costModel: "flat",
    unitCostMinor: 50_000,
    currency: "USD",
  });
  const organicSocial = services.channels.create(ctx, {
    name: "Organic Social",
    code: "organic-social",
    kind: "organic_social",
    costModel: "flat",
    unitCostMinor: 0,
    currency: "USD",
  });

  // --- Campaigns + budgets ---------------------------------------------------
  const q3 = services.campaigns.create(ctx, {
    name: "Q3 Product Launch",
    code: "q3-launch",
    objective: "acquisition",
    utmDefaults: { source: "google", medium: "cpc" },
    description: "Launch of the fall release across paid search, webinars and email",
  });
  services.campaigns.attachChannel(ctx, q3.id, paidSearch.id);
  services.campaigns.attachChannel(ctx, q3.id, email.id);
  services.campaigns.attachChannel(ctx, q3.id, webinar.id);
  services.campaigns.activate(ctx, q3.id);

  const newsletter = services.campaigns.create(ctx, {
    name: "Customer Newsletter",
    code: "newsletter",
    objective: "retention",
    utmDefaults: { source: "newsletter", medium: "email" },
  });
  services.campaigns.attachChannel(ctx, newsletter.id, email.id);
  services.campaigns.attachChannel(ctx, newsletter.id, sms.id);
  services.campaigns.activate(ctx, newsletter.id);

  const q3Budget = services.budgets.create(ctx, {
    campaignId: q3.id,
    totalMinor: 5_000_000, // $50,000.00
    currency: "USD",
    warnThreshold: 0.8,
  });
  services.budgets.recordSpend(ctx, q3Budget.id, {
    amountMinor: 1_200_000,
    currency: "USD",
    category: "media",
    channelId: paidSearch.id,
    note: "August paid search",
  });
  services.budgets.recordSpend(ctx, q3Budget.id, {
    amountMinor: 300_000,
    currency: "USD",
    category: "agency",
    note: "Creative agency retainer",
  });
  services.budgets.recordSpend(ctx, q3Budget.id, {
    amountMinor: 250_000,
    currency: "USD",
    category: "events",
    channelId: webinar.id,
    note: "Webinar platform + speakers",
  });

  const newsletterBudget = services.budgets.create(ctx, {
    campaignId: newsletter.id,
    totalMinor: 500_000, // $5,000.00
    currency: "USD",
  });
  services.budgets.recordSpend(ctx, newsletterBudget.id, {
    amountMinor: 120_000,
    currency: "USD",
    category: "content",
    note: "Copywriting for August issue",
  });

  // --- Content -----------------------------------------------------------------
  const launchEmail = services.content.create(ctx, {
    title: "Q3 Launch Announcement",
    slug: "q3-launch-announce",
    kind: "email_template",
    subject: "{{firstName}}, the fall release is here",
    body: "Hi {{firstName}},\n\nThe new release is live for {{company}}. See what's new inside.\n\n— The Acme team",
    tags: ["launch", "announcement"],
  });
  services.content.submitForReview(ctx, launchEmail.id);
  services.content.approve(ctx, launchEmail.id);

  const reminderSms = services.content.create(ctx, {
    title: "Webinar Reminder SMS",
    slug: "webinar-reminder-sms",
    kind: "sms_template",
    body: "Hi {{firstName}}, your Acme webinar starts in 1 hour. Join: https://acme.example/w/live",
  });
  services.content.submitForReview(ctx, reminderSms.id);
  services.content.approve(ctx, reminderSms.id);

  // --- Leads with journeys -------------------------------------------------
  const alice = services.leads.capture(ctx, {
    email: "alice@nimbusworks.io",
    source: "landing_page",
    firstName: "Alice",
    lastName: "Nguyen",
    company: "NimbusWorks",
    jobTitle: "VP Operations",
    industry: "saas",
    companySize: 850,
    country: "us",
    phone: "+14155550101",
    consentEmail: true,
    consentSms: true,
    landingUrl:
      "https://acme.example/launch?utm_source=google&utm_medium=cpc&utm_campaign=q3-launch&utm_term=erp+suite",
  });
  const bob = services.leads.capture(ctx, {
    email: "bob@meridianpay.com",
    source: "web_form",
    firstName: "Bob",
    lastName: "Okafor",
    company: "MeridianPay",
    jobTitle: "Director of Finance",
    industry: "fintech",
    companySize: 300,
    country: "gb",
    consentEmail: true,
    utm: { source: "google", medium: "cpc", campaign: "q3-launch" },
  });
  const carol = services.leads.capture(ctx, {
    email: "carol@harborlane.co",
    source: "organic",
    firstName: "Carol",
    lastName: "Silva",
    company: "Harbor Lane",
    jobTitle: "Marketing Analyst",
    industry: "retail",
    companySize: 45,
    consentEmail: true,
  });
  const dave = services.leads.capture(ctx, {
    email: "dave@quarryforge.dev",
    source: "webinar",
    firstName: "Dave",
    lastName: "Kim",
    company: "QuarryForge",
    jobTitle: "Head of Engineering",
    industry: "manufacturing",
    companySize: 220,
    consentEmail: true,
    utm: { source: "webinar", medium: "event", campaign: "q3-launch" },
  });
  const erin = services.leads.capture(ctx, {
    email: "erin@brightgrove.org",
    source: "referral",
    firstName: "Erin",
    lastName: "Walsh",
    consentEmail: false, // will be suppressed from email audiences
  });
  const frank = services.leads.capture(ctx, {
    email: "frank@stonebridge.net",
    source: "import",
    firstName: "Frank",
    lastName: "Ivanov",
    company: "Stonebridge",
    jobTitle: "Procurement Lead",
    industry: "construction",
    companySize: 120,
    consentEmail: true,
  });

  // Journeys over the following days.
  clock.advanceDays(1);
  services.leads.recordActivity(ctx, alice.id, {
    type: "webinar_attend",
    campaignId: q3.id,
    channelId: webinar.id,
  });
  services.leads.recordActivity(ctx, dave.id, {
    type: "webinar_attend",
    campaignId: q3.id,
    channelId: webinar.id,
  });
  services.leads.recordActivity(ctx, bob.id, {
    type: "content_download",
    campaignId: q3.id,
    metadata: { asset: "roi-whitepaper" },
  });

  clock.advanceDays(1);
  services.leads.recordActivity(ctx, alice.id, {
    type: "pricing_view",
    campaignId: q3.id,
  });
  services.leads.recordActivity(ctx, bob.id, { type: "pricing_view", campaignId: q3.id });
  services.leads.recordActivity(ctx, carol.id, {
    type: "form_submit",
    utm: { source: "linkedin", medium: "social", campaign: "q3-launch" },
  });

  clock.advanceDays(1);
  services.leads.recordActivity(ctx, alice.id, {
    type: "demo_request",
    campaignId: q3.id,
  });
  services.leads.recordActivity(ctx, alice.id, { type: "form_submit", campaignId: q3.id });
  services.leads.recordActivity(ctx, bob.id, { type: "trial_signup", campaignId: q3.id });
  services.leads.recordActivity(ctx, frank.id, { type: "content_download", campaignId: q3.id });

  // --- Tracked link clicks ---------------------------------------------------
  const link = services.trackedLinks.create(ctx, {
    destinationUrl: "https://acme.example/launch",
    utm: { source: "google", medium: "cpc", campaign: "q3-launch", content: "headline-a" },
    channelId: paidSearch.id,
    shortCode: "q3promo",
  });
  services.trackedLinks.click(ctx, link.shortCode, alice.id);
  services.trackedLinks.click(ctx, link.shortCode, dave.id);
  services.trackedLinks.click(ctx, link.shortCode);

  // --- Segment, audience, send ------------------------------------------------
  const engaged = services.segments.createDynamic(ctx, {
    name: "Engaged & consented",
    description: "Anyone past the subscriber stage who accepts marketing email",
    rule: {
      kind: "and",
      rules: [
        { kind: "condition", field: "consentEmail", op: "eq", value: true },
        { kind: "condition", field: "stage", op: "neq", value: "disqualified" },
      ],
    },
  });
  const audience = services.audiences.build(ctx, {
    segmentId: engaged.id,
    channelKind: "email",
    campaignId: newsletter.id,
  });
  const job = services.sendJobs.create(ctx, {
    campaignId: newsletter.id,
    channelId: email.id,
    audienceId: audience.id,
    contentAssetId: launchEmail.id,
  });
  services.sendJobs.queue(ctx, job.id);
  clock.advanceDays(1);
  services.sendJobs.run(ctx, job.id);

  // --- Scoring & handoffs ------------------------------------------------------
  services.scoring.rescoreAll(ctx);

  services.handoff.handOff(ctx, alice.id, {
    estimatedValueMinor: 1_500_000, // $15,000 opportunity
    currency: "USD",
    attributionModel: "linear",
    notes: "Wants rollout before end of quarter",
    suggestedOwnerUserId: "user_sales_west",
  });
  services.handoff.handOff(ctx, bob.id, {
    estimatedValueMinor: 800_000, // $8,000 opportunity
    currency: "USD",
    attributionModel: "linear",
  });

  clock.advanceDays(2);
  services.handoff.recordDealWon(ctx, alice.id, 1_650_000, "USD");

  return {
    ctx,
    channelIds: {
      paidSearch: paidSearch.id,
      email: email.id,
      sms: sms.id,
      webinar: webinar.id,
      organicSocial: organicSocial.id,
    },
    campaignIds: { q3Launch: q3.id, newsletter: newsletter.id },
    budgetIds: { q3Launch: q3Budget.id, newsletter: newsletterBudget.id },
    leadIds: {
      alice: alice.id,
      bob: bob.id,
      carol: carol.id,
      dave: dave.id,
      erin: erin.id,
      frank: frank.id,
    },
    segmentId: engaged.id,
    audienceId: audience.id,
    sendJobId: job.id,
    trackedLinkCode: link.shortCode,
  };
}

/**
 * One-call demo environment: fixed clock, scripted delivery outcomes, seeded
 * data. Fully deterministic across runs so demo output and seed-based tests
 * always agree.
 */
export function createDemoModule(startAt = "2026-08-03T09:00:00.000Z"): {
  module: MarketingModule;
  clock: FixedClock;
  seed: SeedResult;
} {
  const clock = new FixedClock(startAt);
  const sender = new ScriptedMessageSender();
  // Newsletter send outcomes: alice and dave click, bob only opens, frank bounces.
  sender.script("alice@nimbusworks.io", {
    delivered: true,
    opened: true,
    clicked: true,
    unsubscribed: false,
  });
  sender.script("bob@meridianpay.com", {
    delivered: true,
    opened: true,
    clicked: false,
    unsubscribed: false,
  });
  sender.script("carol@harborlane.co", {
    delivered: true,
    opened: false,
    clicked: false,
    unsubscribed: false,
  });
  sender.script("dave@quarryforge.dev", {
    delivered: true,
    opened: true,
    clicked: true,
    unsubscribed: false,
  });
  sender.script("frank@stonebridge.net", {
    delivered: false,
    opened: false,
    clicked: false,
    unsubscribed: false,
    failureReason: "hard bounce: unknown recipient",
  });

  const module = createMarketingModule({ clock, sender });
  const seed = seedDemoData(module, clock);
  return { module, clock, seed };
}

import { count, percent } from "../../api/module-api.js";
import type {
  AttributionRowDto,
  CampaignDto,
  LeadDto,
  SegmentDto,
} from "../../api/marketing.js";
import { amount, dateOnly, resource, shiftDays, type FixtureBuilder } from "./types.js";

export const buildMarketingFixture: FixtureBuilder = (ctx) => {
  const campaigns: CampaignDto[] = [
    {
      id: "cmp-spring",
      name: "Spring industrial refresh",
      channel: "email",
      status: "running",
      budget: amount(ctx, 40_000_00),
      spend: amount(ctx, 23_450_00),
      startsOn: dateOnly(ctx, -21),
      endsOn: dateOnly(ctx, 14),
      leadsGenerated: 318,
      influencedPipeline: amount(ctx, 412_000_00),
    },
    {
      id: "cmp-paid",
      name: "Always-on paid search",
      channel: "paid-search",
      status: "running",
      budget: amount(ctx, 90_000_00),
      spend: amount(ctx, 61_120_00),
      startsOn: dateOnly(ctx, -120),
      leadsGenerated: 1_204,
      influencedPipeline: amount(ctx, 980_500_00),
    },
    {
      id: "cmp-expo",
      name: "MachineExpo booth",
      channel: "events",
      status: "scheduled",
      budget: amount(ctx, 75_000_00),
      spend: amount(ctx, 5_000_00),
      startsOn: dateOnly(ctx, 30),
      endsOn: dateOnly(ctx, 33),
      leadsGenerated: 0,
      influencedPipeline: amount(ctx, 0),
    },
    {
      id: "cmp-partner",
      name: "Partner co-marketing wave 2",
      channel: "partner",
      status: "paused",
      budget: amount(ctx, 25_000_00),
      spend: amount(ctx, 18_300_00),
      startsOn: dateOnly(ctx, -60),
      endsOn: dateOnly(ctx, -5),
      leadsGenerated: 96,
      influencedPipeline: amount(ctx, 145_000_00),
    },
  ];

  const leads: LeadDto[] = [
    {
      id: "lead-1",
      fullName: "Priya Raman",
      company: "Vertex Fabrication",
      email: "priya@vertexfab.test",
      score: 88,
      status: "new",
      campaignId: "cmp-spring",
      createdAt: shiftDays(ctx, -1),
    },
    {
      id: "lead-2",
      fullName: "Tomas Nilsson",
      company: "Nordic Assembly",
      email: "tomas@nordicasm.test",
      score: 74,
      status: "new",
      campaignId: "cmp-paid",
      createdAt: shiftDays(ctx, -2),
    },
    {
      id: "lead-3",
      fullName: "Grace Otieno",
      company: "Savanna Logistics",
      email: "grace@savannalog.test",
      score: 91,
      status: "working",
      campaignId: "cmp-spring",
      assignedTo: "u-avery",
      createdAt: shiftDays(ctx, -5),
    },
    {
      id: "lead-4",
      fullName: "Marc Dubois",
      company: "Atelier Métal",
      email: "marc@ateliermetal.test",
      score: 52,
      status: "routed",
      campaignId: "cmp-partner",
      assignedTo: "u-jordan",
      createdAt: shiftDays(ctx, -8),
    },
    {
      id: "lead-5",
      fullName: "Ana Beltrán",
      company: "Costera Marine",
      email: "ana@costeramarine.test",
      score: 35,
      status: "disqualified",
      campaignId: "cmp-paid",
      createdAt: shiftDays(ctx, -12),
    },
  ];

  const segments: SegmentDto[] = [
    {
      id: "seg-mfg-eu",
      name: "Manufacturing · EU · 200+ staff",
      definition: "industry = manufacturing AND region = EU AND employees >= 200",
      memberCount: 4_812,
      refreshCadence: "daily",
      lastRefreshedAt: shiftDays(ctx, -1),
    },
    {
      id: "seg-lapsed",
      name: "Lapsed customers (12m)",
      definition: "lastOrderAt < now - 365d AND lifetimeValue > 50000",
      memberCount: 613,
      refreshCadence: "weekly",
      lastRefreshedAt: shiftDays(ctx, -4),
    },
    {
      id: "seg-trial",
      name: "Trial signups awaiting activation",
      definition: "trialStartedAt within 30d AND activatedAt is null",
      memberCount: 289,
      refreshCadence: "hourly",
      lastRefreshedAt: shiftDays(ctx, 0),
    },
  ];

  const attribution: AttributionRowDto[] = [
    {
      id: "attr-email",
      channel: "email",
      model: "linear",
      influencedPipeline: amount(ctx, 412_000_00),
      closedWon: amount(ctx, 96_400_00),
      touchCount: 2_140,
    },
    {
      id: "attr-paid",
      channel: "paid-search",
      model: "linear",
      influencedPipeline: amount(ctx, 980_500_00),
      closedWon: amount(ctx, 218_900_00),
      touchCount: 8_902,
    },
    {
      id: "attr-partner",
      channel: "partner",
      model: "linear",
      influencedPipeline: amount(ctx, 145_000_00),
      closedWon: amount(ctx, 61_250_00),
      touchCount: 412,
    },
    {
      id: "attr-events",
      channel: "events",
      model: "linear",
      influencedPipeline: amount(ctx, 208_000_00),
      closedWon: amount(ctx, 74_000_00),
      touchCount: 188,
    },
  ];

  return {
    module: "marketing",
    resources: [
      resource<CampaignDto>({
        slug: "campaigns",
        rows: campaigns,
        searchable: ["name", "channel", "status"],
        title: (row) => row.name,
        subtitle: (row) => `Campaign · ${row.channel} · ${row.status}`,
      }),
      resource<LeadDto>({
        slug: "leads",
        rows: leads,
        searchable: ["fullName", "company", "email", "status"],
        title: (row) => `${row.fullName} · ${row.company}`,
        subtitle: (row) => `Lead · score ${row.score}`,
      }),
      resource<SegmentDto>({
        slug: "segments",
        rows: segments,
        searchable: ["name", "definition"],
        title: (row) => row.name,
        subtitle: (row) => `Segment · ${row.memberCount} members`,
      }),
      resource<AttributionRowDto>({
        slug: "attribution",
        rows: attribution,
        searchable: ["channel", "model"],
        title: (row) => `${row.channel} (${row.model})`,
        subtitle: () => "Attribution",
      }),
    ],
    summary: {
      module: "marketing",
      asOf: ctx.now,
      metrics: {
        activeCampaigns: count(campaigns.filter((c) => c.status === "running").length),
        spendToDate: { kind: "money", value: amount(ctx, 107_870_00) },
        unroutedLeads: count(leads.filter((l) => l.status === "new").length),
        leadToQuoteRate: percent(0.17),
      },
      deltas: { spendToDate: 0.22, unroutedLeads: 0.5, leadToQuoteRate: -0.02 },
    },
  };
};

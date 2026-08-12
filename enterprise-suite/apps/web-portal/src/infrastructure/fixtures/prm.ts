import { count, percent } from "../../api/module-api.js";
import type {
  DealRegistrationDto,
  EnablementRowDto,
  MdfRequestDto,
  PartnerDto,
} from "../../api/prm.js";
import {
  amount,
  docNumber,
  resource,
  shiftDays,
  type FixtureBuilder,
} from "./types.js";

export const buildPrmFixture: FixtureBuilder = (ctx) => {
  const partners: PartnerDto[] = [
    {
      id: "prt-vector",
      name: "Vector Industrial Group",
      tier: "platinum",
      status: "active",
      region: "EMEA",
      managerId: "u-avery",
      registeredPipeline: amount(ctx, 1_240_000_00),
      certifiedEngineers: 18,
    },
    {
      id: "prt-summit",
      name: "Summit Automation",
      tier: "gold",
      status: "active",
      region: "AMER",
      managerId: "u-avery",
      registeredPipeline: amount(ctx, 486_000_00),
      certifiedEngineers: 9,
    },
    {
      id: "prt-kite",
      name: "Kite Systems",
      tier: "silver",
      status: "onboarding",
      region: "APAC",
      managerId: "u-avery",
      registeredPipeline: amount(ctx, 92_000_00),
      certifiedEngineers: 2,
    },
    {
      id: "prt-halo",
      name: "Halo Integrations",
      tier: "registered",
      status: "suspended",
      region: "AMER",
      managerId: "u-avery",
      registeredPipeline: amount(ctx, 0),
      certifiedEngineers: 0,
    },
  ];

  const deals: DealRegistrationDto[] = [
    {
      id: "deal-1",
      reference: docNumber(ctx, "DR", 1),
      partnerId: "prt-vector",
      partnerName: "Vector Industrial Group",
      customerName: "Rheinmetall Fabrik",
      status: "submitted",
      estimatedValue: amount(ctx, 320_000_00),
      submittedAt: shiftDays(ctx, -2),
      expiresAt: shiftDays(ctx, 88),
    },
    {
      id: "deal-2",
      reference: docNumber(ctx, "DR", 2),
      partnerId: "prt-summit",
      partnerName: "Summit Automation",
      customerName: "Hooli Labs",
      status: "submitted",
      estimatedValue: amount(ctx, 145_000_00),
      submittedAt: shiftDays(ctx, -4),
      expiresAt: shiftDays(ctx, 86),
      conflictsWithOrderId: "so-1",
    },
    {
      id: "deal-3",
      reference: docNumber(ctx, "DR", 3),
      partnerId: "prt-vector",
      partnerName: "Vector Industrial Group",
      customerName: "Costera Marine",
      status: "approved",
      estimatedValue: amount(ctx, 78_000_00),
      submittedAt: shiftDays(ctx, -30),
      expiresAt: shiftDays(ctx, 60),
    },
    {
      id: "deal-4",
      reference: docNumber(ctx, "DR", 4),
      partnerId: "prt-kite",
      partnerName: "Kite Systems",
      customerName: "Pacific Rail",
      status: "expired",
      estimatedValue: amount(ctx, 54_000_00),
      submittedAt: shiftDays(ctx, -120),
      expiresAt: shiftDays(ctx, -30),
    },
  ];

  const mdfRequests: MdfRequestDto[] = [
    {
      id: "mdf-1",
      reference: docNumber(ctx, "MDF", 1),
      partnerId: "prt-vector",
      partnerName: "Vector Industrial Group",
      activity: "Regional roadshow · 4 cities",
      status: "requested",
      requested: amount(ctx, 45_000_00),
    },
    {
      id: "mdf-2",
      reference: docNumber(ctx, "MDF", 2),
      partnerId: "prt-summit",
      partnerName: "Summit Automation",
      activity: "Co-branded webinar series",
      status: "approved",
      requested: amount(ctx, 12_000_00),
      approved: amount(ctx, 9_000_00),
    },
    {
      id: "mdf-3",
      reference: docNumber(ctx, "MDF", 3),
      partnerId: "prt-summit",
      partnerName: "Summit Automation",
      activity: "Trade show booth share",
      status: "claimed",
      requested: amount(ctx, 20_000_00),
      approved: amount(ctx, 20_000_00),
      claimedAt: shiftDays(ctx, -14),
    },
  ];

  const enablement: EnablementRowDto[] = [
    {
      id: "enb-vector",
      partnerId: "prt-vector",
      partnerName: "Vector Industrial Group",
      track: "Platinum delivery",
      requiredCertifications: 12,
      achievedCertifications: 18,
      compliant: true,
    },
    {
      id: "enb-summit",
      partnerId: "prt-summit",
      partnerName: "Summit Automation",
      track: "Gold delivery",
      requiredCertifications: 8,
      achievedCertifications: 9,
      compliant: true,
    },
    {
      id: "enb-kite",
      partnerId: "prt-kite",
      partnerName: "Kite Systems",
      track: "Silver onboarding",
      requiredCertifications: 4,
      achievedCertifications: 2,
      compliant: false,
    },
  ];

  return {
    module: "prm",
    resources: [
      resource<PartnerDto>({
        slug: "partners",
        rows: partners,
        searchable: ["name", "tier", "region", "status"],
        title: (row) => row.name,
        subtitle: (row) => `Partner · ${row.tier}`,
      }),
      resource<DealRegistrationDto>({
        slug: "deals",
        rows: deals,
        searchable: ["reference", "partnerName", "customerName", "status"],
        title: (row) => `${row.reference} · ${row.customerName}`,
        subtitle: (row) => `Deal registration · ${row.partnerName}`,
      }),
      resource<MdfRequestDto>({
        slug: "mdf-requests",
        rows: mdfRequests,
        searchable: ["reference", "partnerName", "activity", "status"],
        title: (row) => `${row.reference} · ${row.partnerName}`,
        subtitle: (row) => `MDF · ${row.status}`,
      }),
      resource<EnablementRowDto>({
        slug: "enablement",
        rows: enablement,
        searchable: ["partnerName", "track"],
        title: (row) => `${row.partnerName} · ${row.track}`,
        subtitle: (row) =>
          `Enablement · ${row.achievedCertifications}/${row.requiredCertifications}`,
      }),
    ],
    summary: {
      module: "prm",
      asOf: ctx.now,
      metrics: {
        activePartners: count(partners.filter((p) => p.status === "active").length),
        registeredPipeline: { kind: "money", value: amount(ctx, 1_818_000_00) },
        pendingDeals: count(deals.filter((d) => d.status === "submitted").length),
        mdfUtilisation: percent(0.63),
        openMdf: count(mdfRequests.filter((m) => m.status === "requested").length),
      },
      deltas: { registeredPipeline: 0.11, pendingDeals: -0.25, mdfUtilisation: 0.07 },
    },
  };
};

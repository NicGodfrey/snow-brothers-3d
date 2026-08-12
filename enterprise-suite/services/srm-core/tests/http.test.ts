import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createSrmServer } from "../src/http/server.js";
import { createContainer } from "../src/infrastructure/container.js";
import { FixedClock } from "../src/infrastructure/memory/stores.js";
import { seedDemoData, type SeedResult } from "../src/infrastructure/seed.js";

let server: Server;
let baseUrl: string;
let seeded: SeedResult;
const clock = new FixedClock("2026-01-01T00:00:00.000Z");

interface CallResult {
  readonly status: number;
  // The HTTP surface is deliberately schema-free at the edge; tests assert on
  // the fields they care about rather than re-declaring every DTO.
  readonly body: any;
}

async function call(
  method: string,
  path: string,
  options: { body?: unknown; tenant?: string | null; user?: string; roles?: string } = {},
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.tenant !== null) headers["x-tenant-id"] = options.tenant ?? "demo";
  headers["x-user-id"] = options.user ?? "http-tester";
  headers["x-roles"] = options.roles ?? "srm.admin,srm.compliance,srm.quality";
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : undefined };
}

before(async () => {
  const container = createContainer({ clock });
  seeded = await seedDemoData(container, "demo");
  server = createSrmServer(container);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

describe("HTTP plumbing", () => {
  it("serves health without a tenant and refuses everything else without one", async () => {
    const health = await call("GET", "/health", { tenant: null });
    assert.equal(health.status, 200);
    assert.deepEqual(health.body, { status: "ok", service: "srm-core" });

    const anonymous = await call("GET", "/suppliers", { tenant: null });
    assert.equal(anonymous.status, 400);
    assert.equal(anonymous.body.code, "TENANT_REQUIRED");
  });

  it("404s an unknown route and 400s malformed JSON", async () => {
    const missing = await call("GET", "/no-such-thing");
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, "ROUTE_NOT_FOUND");

    const response = await fetch(`${baseUrl}/suppliers`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tenant-id": "demo", "x-user-id": "http-tester" },
      body: "{not json",
    });
    assert.equal(response.status, 400);
    assert.equal(((await response.json()) as { code: string }).code, "BAD_JSON");
  });

  it("isolates tenants: the demo fixture is invisible to another tenant", async () => {
    const other = await call("GET", "/suppliers", { tenant: "other-corp" });
    assert.equal(other.status, 200);
    assert.equal(other.body.total, 0);
    const leak = await call("GET", `/suppliers/${seeded.suppliers["NORDIC-STEEL"]!.id}`, { tenant: "other-corp" });
    assert.equal(leak.status, 404);
    assert.equal(leak.body.code, "NOT_FOUND");
  });

  it("maps a domain validation failure onto a 400 with the offending field", async () => {
    const missingField = await call("POST", "/suppliers", { body: { legalName: "No code here" } });
    assert.equal(missingField.status, 400);
    assert.equal(missingField.body.code, "VALIDATION");
    assert.match(missingField.body.message, /code/);

    const badEnum = await call("GET", "/suppliers?status=zombie");
    assert.equal(badEnum.status, 400);
    assert.match(badEnum.body.message, /status/);
  });
});

describe("supplier and category endpoints", () => {
  it("lists, filters and paginates the seeded suppliers", async () => {
    const all = await call("GET", "/suppliers?pageSize=50");
    assert.equal(all.status, 200);
    assert.equal(all.body.total, 5);

    const active = await call("GET", "/suppliers?status=active");
    assert.deepEqual(
      active.body.items.map((supplier: any) => supplier.code).sort(),
      ["ACME-FACILITIES", "NORDIC-STEEL", "SHENZHEN-CIRCUITS"],
    );
    const strategic = await call("GET", "/suppliers?classification=strategic");
    assert.deepEqual(strategic.body.items.map((supplier: any) => supplier.code), ["NORDIC-STEEL"]);
    const inMetals = await call("GET", `/suppliers?categoryId=${seeded.categories["metals"]}`);
    assert.deepEqual(inMetals.body.items.map((supplier: any) => supplier.code), ["NORDIC-STEEL"]);
    const searched = await call("GET", "/suppliers?search=shenzhen");
    assert.equal(searched.body.total, 1);

    const firstPage = await call("GET", "/suppliers?pageSize=2");
    assert.equal(firstPage.body.items.length, 2);
    assert.equal(firstPage.body.total, 5);
  });

  it("reads a supplier by id and by code, and 404s an unknown one", async () => {
    const nordic = seeded.suppliers["NORDIC-STEEL"]!;
    const byId = await call("GET", `/suppliers/${nordic.id}`);
    assert.equal(byId.body.code, "NORDIC-STEEL");
    assert.equal(byId.body.status, "active");
    const byCode = await call("GET", "/suppliers/by-code/nordic-steel");
    assert.equal(byCode.body.id, nordic.id, "codes are matched case-insensitively");
    assert.equal((await call("GET", "/suppliers/by-code/NOPE")).status, 404);
  });

  it("registers a supplier and walks the master data through its own endpoints", async () => {
    const created = await call("POST", "/suppliers", {
      body: {
        code: "HTTP-FORGE",
        legalName: "HTTP Forge Ltd",
        countryCode: "GB",
        taxId: "GB123456789",
        defaultCurrency: "GBP",
        tags: ["new"],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.status, "prospect");
    const id = created.body.id;

    const site = await call("POST", `/suppliers/${id}/sites`, {
      body: {
        code: "HF-LEEDS",
        name: "Leeds forge",
        type: "manufacturing",
        address: { line1: "1 Anvil Road", city: "Leeds", countryCode: "GB" },
        capabilities: ["forging"],
      },
    });
    assert.equal(site.status, 201);
    assert.equal(site.body.isPrimary, true, "the first site becomes the primary one");

    const contact = await call("POST", `/suppliers/${id}/contacts`, {
      body: { name: "Ada Smith", email: "ada@httpforge.example", role: "primary" },
    });
    assert.equal(contact.status, 201);

    const account = await call("POST", `/suppliers/${id}/bank-accounts`, {
      body: {
        label: "Operating",
        bankName: "Barclays",
        countryCode: "GB",
        currency: "GBP",
        accountNumber: "GB33BUKB20201555555555",
      },
    });
    assert.equal(account.status, 201);
    const unverified = await call("GET", `/suppliers/${id}`);
    assert.equal(unverified.body.bankAccounts[0].maskedNumber, "****5555");
    assert.equal(unverified.body.bankAccounts[0].status, "unverified");

    const verified = await call("POST", `/suppliers/${id}/bank-accounts/${unverified.body.bankAccounts[0].id}/verify`);
    assert.equal(verified.status, 200);
    assert.equal(verified.body.bankAccounts[0].status, "verified");

    const premature = await call("POST", `/suppliers/${id}/activate`, { body: { reason: "Skip the gate" } });
    assert.equal(premature.status, 422, "activation only happens through onboarding");
    assert.equal(premature.body.code, "INVALID_STATE");
  });

  it("returns the category tree and the inherited policy", async () => {
    const tree = await call("GET", "/categories/tree");
    assert.equal(tree.status, 200);
    const direct = tree.body.find((node: any) => node.code === "direct");
    assert.deepEqual(
      direct.children.map((child: any) => child.code).sort(),
      ["electronics", "metals"],
    );

    const policy = await call("GET", `/categories/${seeded.categories["electronics"]}/policy`);
    assert.equal(policy.body.path, "direct/electronics");
    assert.equal(policy.body.riskTier, "critical");
    assert.equal(policy.body.requiresQualification, true, "inherited from direct materials");
    assert.deepEqual(policy.body.requiredCertifications.sort(), ["iso14001", "iso9001"]);
    assert.equal(policy.body.requalificationMonths, 12, "the stricter child interval wins");
  });

  it("reports the panel and the gaps that keep a supplier off it", async () => {
    const itServices = seeded.categories["it-services"]!;
    const facilitiesSupplier = seeded.suppliers["ACME-FACILITIES"]!;
    const assigned = await call("POST", `/suppliers/${facilitiesSupplier.id}/categories`, {
      body: { categoryId: itServices, note: "Wants to bid for the NOC contract" },
    });
    assert.equal(assigned.status, 201);
    assert.equal(assigned.body.status, "pending");

    const panel = await call("GET", `/suppliers/${facilitiesSupplier.id}/panel`);
    const entry = panel.body.find((row: any) => row.assignment.categoryId === itServices);
    assert.equal(entry.satisfiesPolicy, false);
    assert.ok(entry.gaps.length >= 2, "no qualification and no ISO 27001 / SOC 2");

    const approval = await call("POST", `/suppliers/${facilitiesSupplier.id}/categories/${itServices}/approve`);
    assert.equal(approval.status, 422);
    assert.match(approval.body.message, /does not meet the policy/);
  });
});

describe("onboarding endpoints", () => {
  it("exposes the templates and the in-flight case's progress", async () => {
    const templates = await call("GET", "/onboarding/templates");
    assert.ok(templates.body.some((template: any) => template.code === "critical-service"));

    const progress = await call("GET", `/onboarding/${seeded.onboardingCaseId}/progress`);
    assert.equal(progress.status, 200);
    assert.equal(progress.body.status, "in_progress");
    assert.equal(progress.body.completion, 0.25, "two of eight steps are done");
    assert.equal(progress.body.riskTier, "high", "the questionnaire answers scored it up from the template floor");
    assert.deepEqual(progress.body.requiredRoles.sort(), ["compliance", "finance", "procurement"]);
    assert.ok(progress.body.outstandingSteps.includes("exec-briefing"));
    assert.ok(progress.body.outstandingDocuments.includes("soc2"), "the buyer is told exactly what is missing");
  });

  it("drives the remaining checklist and blocks a submit that is not ready", async () => {
    const caseId = seeded.onboardingCaseId;
    const early = await call("POST", `/onboarding/${caseId}/submit`);
    assert.equal(early.status, 422);
    assert.equal(early.body.code, "INVALID_STATE");

    const listed = await call("GET", "/onboarding?status=in_progress");
    assert.equal(listed.body.total, 1);
    assert.equal(listed.body.items[0].id, caseId);

    const waived = await call("POST", `/onboarding/${caseId}/steps/bcp-review/waive`, {
      body: { reason: "Hosting platform is covered by the group BCP" },
    });
    assert.equal(waived.status, 200);
    assert.equal(waived.body.status, "waived");
    assert.equal(waived.body.waivedReason, "Hosting platform is covered by the group BCP");
  });
});

describe("qualification and certification endpoints", () => {
  it("filters certifications and refuses a certificate that expires before it is issued", async () => {
    const shenzhen = seeded.suppliers["SHENZHEN-CIRCUITS"]!;
    const held = await call("GET", `/certifications?supplierId=${shenzhen.id}`);
    assert.equal(held.body.total, 4, "two ISO certificates plus the tax form and code of conduct from onboarding");
    const iso = await call("GET", `/certifications?supplierId=${shenzhen.id}&type=iso14001`);
    assert.deepEqual(iso.body.items.map((entry: any) => entry.certificateNumber), ["SGS-14001-40123"]);

    const invalid = await call("POST", "/certifications", {
      body: {
        supplierId: shenzhen.id,
        type: "iso45001",
        issuer: "SGS",
        certificateNumber: "SGS-45001-1",
        issuedOn: "2026-06-01",
        expiresOn: "2026-01-01",
      },
    });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.code, "VALIDATION");
  });

  it("runs the compliance sweep as a job endpoint", async () => {
    const sweep = await call("POST", "/jobs/compliance-sweep", { body: { warningDays: 60 } });
    assert.equal(sweep.status, 200);
    assert.equal(sweep.body.asOf, "2026-01-01");
    assert.deepEqual(
      sweep.body.certificationsExpiring,
      ["SGS-14001-40123"],
      "the seeded certificate 45 days out is the only one inside the window",
    );
    assert.deepEqual(sweep.body.certificationsExpired, []);
  });

  it("reads a qualification back with its sections and findings", async () => {
    const shenzhen = seeded.suppliers["SHENZHEN-CIRCUITS"]!;
    const listed = await call("GET", `/qualifications?supplierId=${shenzhen.id}`);
    assert.equal(listed.body.total, 1);
    const detail = await call("GET", `/qualifications/${listed.body.items[0].id}`);
    assert.equal(detail.body.outcome, "conditional", "an open major finding caps the audit");
    assert.equal(detail.body.findings.length, 1);
    assert.equal(detail.body.findings[0].severity, "major");
  });
});

describe("performance endpoints", () => {
  it("resolves performance periods from a code and from a date", async () => {
    const quarter = await call("GET", "/periods/2026-Q1");
    assert.equal(quarter.status, 200);
    assert.deepEqual(
      { start: quarter.body.start, end: quarter.body.end },
      { start: "2026-01-01", end: "2026-03-31" },
    );
    const containing = await call("GET", "/periods?kind=month&date=2026-05-17");
    assert.equal(containing.body.code, "2026-05");
    const nonsense = await call("GET", "/periods/2026-Q9");
    assert.equal(nonsense.status, 400);
  });

  it("ranks the period and names the suppliers with no scorecard", async () => {
    const ranking = await call("GET", "/performance/ranking/2025-Q4");
    assert.equal(ranking.status, 200);
    assert.deepEqual(
      ranking.body.map((row: any) => row.supplierCode),
      ["NORDIC-STEEL", "SHENZHEN-CIRCUITS"],
      "best score first",
    );
    assert.equal(ranking.body[0].rating, "excellent");
    assert.equal(ranking.body[1].rating, "watch");

    const gaps = await call("GET", "/performance/gaps/2025-Q4");
    assert.deepEqual(gaps.body, ["ACME-FACILITIES"], "the third active supplier was never scored");
  });

  it("rejects a measurement for a KPI nobody defined", async () => {
    const nordic = seeded.suppliers["NORDIC-STEEL"]!;
    const scorecard = await call("POST", "/scorecards", {
      body: { supplierId: nordic.id, periodCode: "2026-Q1" },
    });
    assert.equal(scorecard.status, 201);
    const unknown = await call("POST", `/scorecards/${scorecard.body.id}/measurements`, {
      body: { kpiCode: "vibes", value: 10 },
    });
    assert.equal(unknown.status, 404);

    const premature = await call("POST", `/scorecards/${scorecard.body.id}/publish`);
    assert.equal(premature.status, 422);
    assert.match(premature.body.message, /mandatory/);
  });
});

describe("contract endpoints", () => {
  it("quotes the contracted price for a quantity and 404s an uncovered item", async () => {
    const nordic = seeded.suppliers["NORDIC-STEEL"]!;
    const single = await call("GET", `/suppliers/${nordic.id}/price-quote?itemCode=COIL-GALV-1.5&quantity=500`);
    assert.equal(single.status, 200);
    assert.equal(single.body.unitPrice.amountMinor, 142);

    const bulk = await call("GET", `/suppliers/${nordic.id}/price-quote?itemCode=COIL-GALV-1.5&quantity=25000`);
    assert.equal(bulk.body.unitPrice.amountMinor, 129, "the volume tier applies from 20k");
    assert.equal(bulk.body.extendedPrice.amountMinor, 129 * 25_000);

    const uncovered = await call("GET", `/suppliers/${nordic.id}/price-quote?itemCode=UNOBTANIUM&quantity=1`);
    assert.equal(uncovered.status, 404);
    assert.equal(uncovered.body.code, "NO_CONTRACTED_PRICE");

    const noQuantity = await call("GET", `/suppliers/${nordic.id}/price-quote?itemCode=COIL-GALV-1.5`);
    assert.equal(noQuantity.status, 400);
  });

  it("records an SLA result and returns the credit it earned", async () => {
    const contractId = seeded.contracts["shenzhen"]!;
    const contract = await call("GET", `/contracts/${contractId}`);
    const commitmentId = contract.body.commitments[0].id;
    assert.deepEqual(
      contract.body.breaches.map((breach: any) => [breach.periodCode, breach.measured, breach.severity]),
      [["2025-Q4", 1450, "major"]],
      "publishing the seeded scorecard already fed the SLA without anyone re-keying it",
    );

    const rerun = await call("POST", `/contracts/${contractId}/sla-results`, {
      body: { commitmentId, periodCode: "2025-Q4", measured: 1450 },
    });
    assert.equal(rerun.status, 422, "a period is recorded once");

    const inside = await call("POST", `/contracts/${contractId}/sla-results`, {
      body: { commitmentId, periodCode: "2025-Q3", measured: 950, periodSpendMinor: 500_000_00 },
    });
    assert.equal(inside.status, 200);
    assert.equal(inside.body.breached, false, "950 PPM is inside the 800 +/- 200 tolerance");

    const missed = await call("POST", `/contracts/${contractId}/sla-results`, {
      body: { commitmentId, periodCode: "2026-Q1", measured: 2400, periodSpendMinor: 500_000_00 },
    });
    assert.equal(missed.body.breached, true);
    assert.equal(missed.body.breach.severity, "severe");
    assert.equal(missed.body.breach.deviation, 1600);
    assert.equal(missed.body.breach.credit.amountMinor, 4_500_000, "3 x 3% of a 500k spend, inside the 15% cap");

    const withBreach = await call("GET", `/contracts/${contractId}`);
    assert.equal(withBreach.body.breaches.length, 2);
    const acknowledged = await call(
      "POST",
      `/contracts/${contractId}/breaches/${missed.body.breach.id}/acknowledge`,
      { body: { note: "Discussed at the QBR" } },
    );
    assert.equal(acknowledged.body.status, "acknowledged");
  });

  it("lists the contracts that expire inside a horizon", async () => {
    const expiring = await call("GET", "/contracts/expiring?withinDays=300");
    assert.deepEqual(
      expiring.body.map((contract: any) => contract.type),
      ["pricing_agreement"],
      "only the 9-month pricing agreement lands inside the window",
    );
    assert.equal((await call("GET", "/contracts/expiring?withinDays=30")).body.length, 0);
  });
});

describe("risk, hold and eligibility endpoints", () => {
  it("raises a flag, mitigates it and reports the tier on the profile", async () => {
    const facilities = seeded.suppliers["ACME-FACILITIES"]!;
    const raised = await call("POST", `/suppliers/${facilities.id}/risk/flags`, {
      body: {
        category: "cyber",
        title: "Unpatched remote access appliance",
        source: "monitoring",
        likelihood: 4,
        impact: 4,
        detectedOn: "2026-01-01",
        reviewDueOn: "2026-02-01",
      },
    });
    assert.equal(raised.status, 201);
    assert.equal(raised.body.severity, "critical");
    assert.equal(raised.body.inherentScore, 16);

    const profile = await call("GET", `/suppliers/${facilities.id}/risk`);
    assert.equal(profile.body.tier, "high");

    const mitigated = await call("POST", `/suppliers/${facilities.id}/risk/flags/${raised.body.id}/mitigate`, {
      body: {
        plan: "Patch and move the appliance behind the VPN",
        dueOn: "2026-02-15",
        residualLikelihood: 2,
        residualImpact: 2,
      },
    });
    assert.equal(mitigated.status, 200);
    assert.equal(mitigated.body.residualScore, 4);
    assert.equal((await call("GET", `/suppliers/${facilities.id}/risk`)).body.tier, "low");

    const rejected = await call("POST", `/suppliers/${facilities.id}/risk/flags`, {
      body: { category: "cyber", title: "Bad score", source: "monitoring", likelihood: 9, impact: 1, detectedOn: "2026-01-01" },
    });
    assert.equal(rejected.status, 400);
  });

  it("places a role-gated hold and answers the clearance question", async () => {
    const shenzhen = seeded.suppliers["SHENZHEN-CIRCUITS"]!;
    const hold = await call("POST", `/suppliers/${shenzhen.id}/holds`, {
      body: {
        type: "sourcing",
        reasonCode: "sanctions_match",
        note: "Screening hit on a beneficial owner",
        releaseRoles: ["srm.compliance"],
      },
    });
    assert.equal(hold.status, 201);

    const sourcing = await call("GET", `/suppliers/${shenzhen.id}/clearance/sourcing`);
    assert.equal(sourcing.body.cleared, false);
    const po = await call("GET", `/suppliers/${shenzhen.id}/clearance/purchase_order`);
    assert.equal(po.body.cleared, false, "a sourcing hold also stops the PO");
    const payment = await call("GET", `/suppliers/${shenzhen.id}/clearance/payment`);
    assert.equal(payment.body.cleared, true);
    assert.equal((await call("GET", `/suppliers/${shenzhen.id}/clearance/dancing`)).status, 400);

    const buyerAttempt = await call("POST", `/suppliers/${shenzhen.id}/holds/${hold.body.id}/release`, {
      body: { reason: "The supplier says it is fine" },
      user: "buyer-9",
      roles: "srm.buyer",
    });
    assert.equal(buyerAttempt.status, 403);
    assert.equal(buyerAttempt.body.code, "ROLE_REQUIRED");
    assert.deepEqual(buyerAttempt.body.details.requiredRoles, ["srm.compliance"]);

    const released = await call("POST", `/suppliers/${shenzhen.id}/holds/${hold.body.id}/release`, {
      body: { reason: "Screening cleared: name match only" },
      user: "compliance-1",
      roles: "srm.compliance",
    });
    assert.equal(released.status, 200);
    assert.equal((await call("GET", `/suppliers/${shenzhen.id}/clearance/sourcing`)).body.cleared, true);
  });

  it("assesses award eligibility per category and rolls the supplier up in one call", async () => {
    const nordic = seeded.suppliers["NORDIC-STEEL"]!;
    const eligible = await call("GET", `/suppliers/${nordic.id}/eligibility?categoryId=${seeded.categories["metals"]}`);
    assert.equal(eligible.status, 200);
    assert.equal(eligible.body.eligible, true);
    assert.deepEqual(eligible.body.blockers, []);
    assert.ok(eligible.body.governingContractId, "the framework agreement covers the award");

    const wrongPanel = await call(
      "GET",
      `/suppliers/${nordic.id}/eligibility?categoryId=${seeded.categories["electronics"]}`,
    );
    assert.equal(wrongPanel.body.eligible, false);
    assert.ok(
      wrongPanel.body.blockers.map((issue: any) => issue.code).includes("category_not_assigned"),
      "steel is not on the electronics panel",
    );

    const overview = await call("GET", `/suppliers/${nordic.id}/overview`);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.supplier.code, "NORDIC-STEEL");
    assert.equal(overview.body.activeContracts, 1);
    assert.equal(overview.body.latestScorecard.periodCode, "2025-Q4");
    assert.equal(overview.body.activeHolds, 0);
  });

  it("orders the risk heatmap and filters it by tier", async () => {
    const heatmap = await call("GET", "/risk/heatmap");
    assert.equal(heatmap.status, 200);
    assert.ok(heatmap.body.length >= 2);
    for (let index = 1; index < heatmap.body.length; index += 1) {
      assert.ok(heatmap.body[index - 1].score >= heatmap.body[index].score, "worst first");
    }
    const critical = await call("GET", "/risk/heatmap?minimumTier=critical");
    assert.ok(critical.body.length <= heatmap.body.length);
    const badTier = await call("GET", "/risk/heatmap?minimumTier=apocalyptic");
    assert.equal(badTier.status, 400);
  });

  it("serves the tenant's event log for diagnostics", async () => {
    const raised = await call("GET", "/events?type=srm.risk.flag-raised");
    assert.equal(raised.status, 200);
    assert.ok(raised.body.length >= 1);
    assert.ok(raised.body.every((event: any) => event.eventType === "srm.risk.flag-raised"));
    assert.equal((await call("GET", "/events", { tenant: "other-corp" })).body.length, 0);
  });
});

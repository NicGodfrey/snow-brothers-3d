import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { IsoDateTime, Ulid } from "@enterprise-suite/shared-kernel";
import {
  detectConflicts,
  hasBlockingFinding,
  recommendOutcome,
  scoreClaim,
  type DetectionInput,
  type RegistrationClaim,
} from "../src/domain/conflict.js";
import { addDays } from "../src/domain/protection.js";
import { asUlid, usd } from "./helpers.js";

const NOW = "2026-03-01T00:00:00.000Z" as IsoDateTime;
const CUSTOMER = "domain:contoso.com";
const INCUMBENT_PARTNER = asUlid("prt_incumbent");
const CLAIMANT_PARTNER = asUlid("prt_claimant");

function claim(overrides: Partial<RegistrationClaim> = {}): RegistrationClaim {
  return {
    registrationId: asUlid("reg_incumbent"),
    number: "DR-00001",
    partnerId: INCUMBENT_PARTNER,
    customerKey: CUSTOMER,
    productLines: ["network-security"],
    status: "approved",
    stage: "qualified",
    estimatedValue: usd(10_000_000),
    protection: { startsAt: "2026-02-01T00:00:00.000Z" as IsoDateTime, endsAt: "2026-05-01T00:00:00.000Z" as IsoDateTime },
    lastActivityAt: "2026-02-25T00:00:00.000Z" as IsoDateTime,
    quoteCount: 0,
    orderCount: 0,
    ...overrides,
  };
}

function detection(overrides: Partial<DetectionInput> = {}): DetectionInput {
  return {
    customerKey: CUSTOMER,
    partnerId: CLAIMANT_PARTNER,
    productLines: ["network-security"],
    requestedWindow: { startsAt: NOW, endsAt: addDays(NOW, 90) },
    existing: [],
    at: NOW,
    ...overrides,
  };
}

describe("conflict detection", () => {
  it("finds nothing when the product lines do not overlap", () => {
    const findings = detectConflicts(
      detection({ productLines: ["endpoint"], existing: [claim({ productLines: ["network-security"] })] }),
    );
    assert.deepEqual(findings, []);
  });

  it("finds nothing against a different customer", () => {
    const findings = detectConflicts(detection({ existing: [claim({ customerKey: "domain:fabrikam.de" })] }));
    assert.deepEqual(findings, []);
  });

  it("blocks a partner registering the same customer twice", () => {
    const findings = detectConflicts(detection({ partnerId: INCUMBENT_PARTNER, existing: [claim()] }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, "duplicate_registration");
    assert.equal(findings[0]!.severity, "blocking");
    assert.match(findings[0]!.explanation, /You already have DR-00001/);
    assert.equal(hasBlockingFinding(findings), true);
  });

  it("blocks another partner while protection is live and reports the shared days", () => {
    const findings = detectConflicts(detection({ existing: [claim()] }));
    assert.equal(findings.length, 1);
    const finding = findings[0]!;
    assert.equal(finding.kind, "partner_vs_partner");
    assert.equal(finding.severity, "blocking");
    assert.equal(finding.incumbentNumber, "DR-00001");
    assert.equal(finding.incumbentProtectionEndsAt, "2026-05-01T00:00:00.000Z");
    // Requested window 1 Mar - 30 May against protection ending 1 May.
    assert.equal(finding.overlapDays, 61);
    assert.deepEqual(finding.overlappingProductLines, ["network-security"]);
  });

  it("downgrades to advisory once the incumbent's protection has lapsed", () => {
    const lapsed = claim({
      protection: { startsAt: "2025-11-01T00:00:00.000Z" as IsoDateTime, endsAt: "2026-01-01T00:00:00.000Z" as IsoDateTime },
      status: "approved",
    });
    assert.deepEqual(detectConflicts(detection({ existing: [lapsed] })), [], "an expired window blocks nothing");

    const pending = claim({ status: "submitted", protection: undefined });
    const findings = detectConflicts(detection({ existing: [pending] }));
    assert.equal(findings.length, 1);
    assert.equal(findings[0]!.kind, "partner_vs_pending");
    assert.equal(findings[0]!.severity, "advisory");
    assert.equal(hasBlockingFinding(findings), false);
  });

  it("blocks house accounts, honouring a product-line-scoped claim", () => {
    const all = detectConflicts(
      detection({ directClaims: [{ customerKey: CUSTOMER, reason: "strategic direct account" }] }),
    );
    assert.equal(all.length, 1);
    assert.equal(all[0]!.kind, "partner_vs_direct");
    assert.match(all[0]!.explanation, /house account/);

    const scoped = detectConflicts(
      detection({
        productLines: ["endpoint"],
        directClaims: [{ customerKey: CUSTOMER, reason: "direct on the platform only", productLines: ["cloud-platform"] }],
      }),
    );
    assert.deepEqual(scoped, [], "a house claim only covers the lines it names");
  });

  it("reports every colliding claim, not just the first", () => {
    const findings = detectConflicts(
      detection({
        existing: [
          claim(),
          claim({ registrationId: asUlid("reg_other"), number: "DR-00002", partnerId: asUlid("prt_third"), protection: undefined, status: "submitted" }),
        ],
        directClaims: [{ customerKey: CUSTOMER, reason: "also a house account" }],
      }),
    );
    assert.deepEqual(findings.map((f) => f.kind).sort(), [
      "partner_vs_direct",
      "partner_vs_partner",
      "partner_vs_pending",
    ]);
  });
});

describe("claim scoring and outcome recommendation", () => {
  it("scores stage, documents, protection left and staleness, and explains each", () => {
    const score = scoreClaim(
      claim({ stage: "negotiation", quoteCount: 2, orderCount: 0, lastActivityAt: "2026-02-28T00:00:00.000Z" as IsoDateTime }),
      NOW,
    );
    const factors = Object.fromEntries(score.factors.map((f) => [f.factor, f.points]));
    assert.equal(factors["stage"], 30, "negotiation ranks third of the open stages");
    assert.equal(factors["documents"], 16);
    assert.equal(factors["protection"], 20, "capped at 20 points however long the window");
    assert.equal(factors["staleness"], undefined, "fresh activity is not penalised");
    assert.equal(score.score, 66);

    const stale = scoreClaim(
      claim({ stage: "prospect", lastActivityAt: "2025-11-01T00:00:00.000Z" as IsoDateTime }),
      NOW,
    );
    const stalePoints = stale.factors.find((f) => f.factor === "staleness")!;
    assert.ok(stalePoints.points < 0);
    assert.match(stalePoints.note, /days without activity/);
  });

  it("upholds the incumbent when both partners are engaged", () => {
    const recommendation = recommendOutcome(claim({ registrationId: asUlid("reg_claimant"), partnerId: CLAIMANT_PARTNER, protection: undefined }), claim(), NOW);
    assert.equal(recommendation.outcome, "incumbent_upheld");
    assert.match(recommendation.rationale, /first-to-register stands/);
    assert.ok(recommendation.incumbentScore);
  });

  it("awards the claimant only when the incumbent looks abandoned", () => {
    const abandoned = claim({
      stage: "prospect",
      lastActivityAt: "2025-09-01T00:00:00.000Z" as IsoDateTime,
      protection: undefined,
    });
    const active = claim({
      registrationId: asUlid("reg_claimant"),
      partnerId: CLAIMANT_PARTNER,
      stage: "negotiation",
      quoteCount: 3,
      orderCount: 1,
      protection: undefined,
    });
    const recommendation = recommendOutcome(active, abandoned, NOW);
    assert.equal(recommendation.outcome, "claimant_awarded");
    assert.match(recommendation.rationale, /looks abandoned/);
  });

  it("recommends co-sell for a close call", () => {
    const incumbent = claim({ stage: "qualified", protection: undefined });
    const claimant = claim({
      registrationId: asUlid("reg_claimant"),
      partnerId: CLAIMANT_PARTNER,
      stage: "proposal",
      quoteCount: 1,
      protection: undefined,
    });
    const recommendation = recommendOutcome(claimant, incumbent, NOW);
    assert.equal(recommendation.outcome, "co_sell");
    assert.match(recommendation.rationale, /Both partners have real engagement/);
  });

  it("awards a claimant with no incumbent at all", () => {
    const recommendation = recommendOutcome(claim({ partnerId: CLAIMANT_PARTNER }), undefined, NOW);
    assert.equal(recommendation.outcome, "claimant_awarded");
    assert.equal(recommendation.incumbentScore, undefined);
  });
});

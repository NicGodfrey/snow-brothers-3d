import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { brand, tenantId, type IsoDateTime } from "@enterprise-suite/shared-kernel";
import { Lead } from "../src/domain/lead.js";
import {
  describeSegmentRule,
  evaluateSegmentRule,
  Segment,
  validateSegmentRule,
  type SegmentRule,
} from "../src/domain/segment.js";

const tenant = tenantId("t_segments");
const t0 = brand<string, "IsoDateTime">("2026-08-01T00:00:00.000Z") as IsoDateTime;

function lead(input: Partial<Parameters<typeof Lead.capture>[0]> & { email: string }): Lead {
  return Lead.capture({
    tenantId: tenant,
    source: "web_form",
    capturedAt: t0,
    ...input,
  });
}

describe("segment rule validation", () => {
  it("accepts a well-formed nested rule", () => {
    const rule: SegmentRule = {
      kind: "and",
      rules: [
        { kind: "condition", field: "industry", op: "in", value: ["saas", "fintech"] },
        {
          kind: "or",
          rules: [
            { kind: "condition", field: "score", op: "gte", value: 40 },
            { kind: "condition", field: "tags", op: "has", value: "vip" },
          ],
        },
        { kind: "not", rule: { kind: "condition", field: "stage", op: "eq", value: "disqualified" } },
      ],
    };
    validateSegmentRule(rule);
  });

  it("rejects empty groups", () => {
    assert.throws(() => validateSegmentRule({ kind: "and", rules: [] }), /at least one/);
  });

  it("rejects numeric ops with non-numeric values", () => {
    assert.throws(
      () =>
        validateSegmentRule({ kind: "condition", field: "score", op: "gte", value: "40" }),
      /numeric/,
    );
  });

  it("rejects 'has' on non-tag fields", () => {
    assert.throws(
      () => validateSegmentRule({ kind: "condition", field: "industry", op: "has", value: "x" }),
      /tags/,
    );
  });

  it("rejects overly deep nesting", () => {
    let rule: SegmentRule = { kind: "condition", field: "score", op: "gte", value: 1 };
    for (let i = 0; i < 7; i++) rule = { kind: "not", rule };
    assert.throws(() => validateSegmentRule(rule), /max depth/);
  });
});

describe("segment rule evaluation", () => {
  const alice = lead({
    email: "alice@saasco.io",
    industry: "saas",
    jobTitle: "VP Sales",
    companySize: 400,
    consentEmail: true,
    tags: ["vip"],
  });
  const bob = lead({ email: "bob@retail.shop", industry: "retail", companySize: 12 });

  it("matches field conditions case-insensitively", () => {
    const rule: SegmentRule = { kind: "condition", field: "industry", op: "eq", value: "SaaS" };
    assert.ok(evaluateSegmentRule(rule, alice.view()));
    assert.ok(!evaluateSegmentRule(rule, bob.view()));
  });

  it("supports contains, gte and boolean consent fields", () => {
    assert.ok(
      evaluateSegmentRule(
        { kind: "condition", field: "jobTitle", op: "contains", value: "vp" },
        alice.view(),
      ),
    );
    assert.ok(
      evaluateSegmentRule(
        { kind: "condition", field: "companySize", op: "gte", value: 100 },
        alice.view(),
      ),
    );
    assert.ok(
      evaluateSegmentRule(
        { kind: "condition", field: "consentEmail", op: "eq", value: true },
        alice.view(),
      ),
    );
    assert.ok(
      !evaluateSegmentRule(
        { kind: "condition", field: "consentEmail", op: "eq", value: true },
        bob.view(),
      ),
    );
  });

  it("supports tag membership and exists", () => {
    assert.ok(
      evaluateSegmentRule({ kind: "condition", field: "tags", op: "has", value: "VIP" }, alice.view()),
    );
    assert.ok(
      evaluateSegmentRule({ kind: "condition", field: "jobTitle", op: "exists" }, alice.view()),
    );
    assert.ok(
      !evaluateSegmentRule({ kind: "condition", field: "jobTitle", op: "exists" }, bob.view()),
    );
  });

  it("combines and/or/not", () => {
    const rule: SegmentRule = {
      kind: "and",
      rules: [
        { kind: "condition", field: "industry", op: "in", value: ["saas", "fintech"] },
        { kind: "not", rule: { kind: "condition", field: "companySize", op: "lte", value: 50 } },
      ],
    };
    assert.ok(evaluateSegmentRule(rule, alice.view()));
    assert.ok(!evaluateSegmentRule(rule, bob.view()));
  });
});

describe("Segment aggregate", () => {
  it("dynamic segments evaluate their rule", () => {
    const segment = Segment.createDynamic({
      tenantId: tenant,
      name: "SaaS decision makers",
      rule: { kind: "condition", field: "industry", op: "eq", value: "saas" },
    });
    const alice = lead({ email: "a@x.io", industry: "saas" });
    const bob = lead({ email: "b@x.io", industry: "retail" });
    assert.ok(segment.matches(alice.view()));
    assert.ok(!segment.matches(bob.view()));
  });

  it("static segments match explicit members only", () => {
    const alice = lead({ email: "a2@x.io" });
    const segment = Segment.createStatic({ tenantId: tenant, name: "Handpicked", memberIds: [alice.id] });
    const bob = lead({ email: "b2@x.io" });
    assert.ok(segment.matches(alice.view()));
    assert.ok(!segment.matches(bob.view()));
    assert.throws(() => segment.updateRule({ kind: "condition", field: "score", op: "gte", value: 1 }), /dynamic/);
  });

  it("archived segments match nothing and refuse edits", () => {
    const segment = Segment.createDynamic({
      tenantId: tenant,
      name: "To be archived",
      rule: { kind: "condition", field: "score", op: "gte", value: 0 },
    });
    const anyone = lead({ email: "c@x.io" });
    assert.ok(segment.matches(anyone.view()));
    segment.archive();
    assert.ok(!segment.matches(anyone.view()));
    assert.throws(
      () => segment.updateRule({ kind: "condition", field: "score", op: "gte", value: 1 }),
      /archived/,
    );
  });

  it("describes rules for audit logs", () => {
    const description = describeSegmentRule({
      kind: "and",
      rules: [
        { kind: "condition", field: "industry", op: "eq", value: "saas" },
        { kind: "not", rule: { kind: "condition", field: "tags", op: "has", value: "churned" } },
      ],
    });
    assert.equal(description, '(industry eq "saas" AND NOT tags has "churned")');
  });
});

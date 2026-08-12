import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InvalidStateError, ValidationError } from "../src/domain/errors.js";
import { bucketFor, FeatureFlag, matchesCondition } from "../src/domain/feature-flag.js";
import { activeTenant, harness, rejects } from "./support.js";

const tenant = "northwind" as never;

describe("targeting conditions", () => {
  const context = {
    subject: "ada@northwind.example",
    attributes: { site: "leeds", seats: 42, plan: "enterprise", beta: true },
  };

  it("implements every operator in the catalogue", () => {
    const cases: [string, boolean][] = [
      [JSON.stringify({ attribute: "site", operator: "equals", values: ["leeds"] }), true],
      [JSON.stringify({ attribute: "site", operator: "equals", values: ["derby"] }), false],
      [JSON.stringify({ attribute: "site", operator: "not-equals", values: ["derby"] }), true],
      [JSON.stringify({ attribute: "site", operator: "in", values: ["leeds", "derby"] }), true],
      [JSON.stringify({ attribute: "site", operator: "not-in", values: ["leeds"] }), false],
      [JSON.stringify({ attribute: "subject", operator: "contains", values: ["@northwind"] }), true],
      [JSON.stringify({ attribute: "subject", operator: "starts-with", values: ["ada"] }), true],
      [JSON.stringify({ attribute: "seats", operator: "gt", values: ["40"] }), true],
      [JSON.stringify({ attribute: "seats", operator: "lt", values: ["40"] }), false],
      [JSON.stringify({ attribute: "beta", operator: "equals", values: ["true"] }), true],
      [JSON.stringify({ attribute: "region", operator: "exists", values: [] }), false],
      [JSON.stringify({ attribute: "site", operator: "exists", values: [] }), true],
    ];

    for (const [serialized, expected] of cases) {
      assert.equal(matchesCondition(JSON.parse(serialized), context), expected, serialized);
    }
  });

  it("treats a missing attribute as not matching a positive operator", () => {
    assert.equal(
      matchesCondition({ attribute: "region", operator: "equals", values: ["emea"] }, context),
      false,
    );
    assert.equal(
      matchesCondition({ attribute: "region", operator: "not-equals", values: ["emea"] }, context),
      true,
      "a negative operator is satisfied by absence",
    );
    assert.equal(
      matchesCondition({ attribute: "seats", operator: "gt", values: ["not-a-number"] }, context),
      false,
    );
  });
});

describe("bucketing", () => {
  it("is stable per flag and subject and independent between flags", () => {
    assert.equal(bucketFor("new-order-workspace", "ada"), bucketFor("new-order-workspace", "ada"));
    assert.notEqual(bucketFor("new-order-workspace", "ada"), bucketFor("mrp-parallel-run", "ada"));
    for (const bucket of ["a", "b", "c", "d"].map((s) => bucketFor("flag", s))) {
      assert.ok(bucket >= 0 && bucket < 10_000);
    }
  });

  it("spreads a sample roughly evenly, so a percentage means something", () => {
    const subjects = Array.from({ length: 4_000 }, (_, i) => `user-${i}@example.com`);
    const inTenPercent = subjects.filter((subject) => bucketFor("spread-check", subject) < 1_000).length;
    const share = inTenPercent / subjects.length;
    assert.ok(share > 0.07 && share < 0.13, `expected roughly 10% in bucket, got ${(share * 100).toFixed(1)}%`);
  });

  it("only widens membership as the rollout percentage grows", () => {
    const flag = FeatureFlag.create(tenant, { key: "widening", name: "Widening", enabled: true });
    const subjects = Array.from({ length: 500 }, (_, i) => `user-${i}`);

    let previous: string[] = [];
    for (const percentage of [10, 25, 50, 100]) {
      flag.update({ rolloutPercentage: percentage });
      const included = subjects.filter((subject) => flag.evaluate({ subject }).value === true);
      for (const subject of previous) {
        assert.ok(included.includes(subject), `${subject} dropped out at ${percentage}%`);
      }
      previous = included;
    }
    assert.equal(previous.length, subjects.length, "everyone is in at 100%");
  });
});

describe("feature flag aggregate", () => {
  it("resolves disabled, then rules, then rollout, then default", () => {
    const flag = FeatureFlag.create(tenant, {
      key: "new-order-workspace",
      name: "New order workspace",
      enabled: false,
      rolloutPercentage: 100,
      rules: [
        {
          id: "pilot",
          priority: 10,
          conditions: [{ attribute: "site", operator: "in", values: ["leeds"] }],
          value: true,
        },
        {
          id: "contractors",
          priority: 20,
          conditions: [{ attribute: "employmentType", operator: "equals", values: ["contractor"] }],
          value: false,
        },
      ],
    });

    assert.deepEqual(
      { ...flag.evaluate({ subject: "ada", attributes: { site: "leeds" } }) },
      { key: "new-order-workspace", value: false, reason: "flag-disabled" },
      "a disabled flag short-circuits every rule",
    );

    flag.toggle(true, "ada");
    const pilot = flag.evaluate({ subject: "ada", attributes: { site: "leeds" } });
    assert.equal(pilot.reason, "rule-match");
    assert.equal(pilot.ruleId, "pilot");

    const contractor = flag.evaluate({
      subject: "raj",
      attributes: { site: "derby", employmentType: "contractor" },
    });
    assert.equal(contractor.value, false);
    assert.equal(contractor.ruleId, "contractors");

    const rollout = flag.evaluate({ subject: "mei", attributes: { site: "derby" } });
    assert.equal(rollout.reason, "percentage-rollout");
    assert.equal(rollout.value, true);
  });

  it("evaluates rules in priority order regardless of insertion order", () => {
    const flag = FeatureFlag.create(tenant, { key: "ordered", name: "Ordered", enabled: true });
    flag.upsertRule({
      id: "broad",
      priority: 50,
      conditions: [{ attribute: "site", operator: "exists", values: [] }],
      value: false,
    });
    flag.upsertRule({
      id: "narrow",
      priority: 10,
      conditions: [{ attribute: "site", operator: "equals", values: ["leeds"] }],
      value: true,
    });

    assert.deepEqual(flag.rules.map((rule) => rule.id), ["narrow", "broad"]);
    assert.equal(flag.evaluate({ subject: "ada", attributes: { site: "leeds" } }).value, true);
    assert.equal(flag.evaluate({ subject: "ada", attributes: { site: "derby" } }).value, false);
  });

  it("skips a disabled rule without removing it", () => {
    const flag = FeatureFlag.create(tenant, { key: "skippable", name: "Skippable", enabled: true });
    flag.upsertRule({
      id: "pilot",
      conditions: [{ attribute: "site", operator: "equals", values: ["leeds"] }],
      value: true,
      enabled: false,
    });
    assert.equal(flag.rules.length, 1);
    assert.equal(flag.evaluate({ subject: "ada", attributes: { site: "leeds" } }).reason, "default");
  });

  it("keeps non-boolean flags type safe", () => {
    const flag = FeatureFlag.create(tenant, {
      key: "invoice-pdf-template",
      name: "Invoice template",
      valueType: "string",
      defaultValue: "classic",
      onValue: "modern",
      offValue: "classic",
      enabled: true,
    });

    assert.throws(
      () => flag.upsertRule({ conditions: [{ attribute: "plan", operator: "exists", values: [] }], value: true }),
      ValidationError,
    );
    flag.upsertRule({
      conditions: [{ attribute: "plan", operator: "equals", values: ["enterprise"] }],
      value: "modern",
    });
    assert.equal(flag.evaluate({ subject: "ada", attributes: { plan: "enterprise" } }).value, "modern");
    assert.equal(flag.evaluate({ subject: "ada", attributes: { plan: "trial" } }).value, "classic");
  });

  it("validates keys, percentages and empty rules", () => {
    assert.throws(() => FeatureFlag.create(tenant, { key: "Bad Key", name: "Bad" }), ValidationError);
    assert.throws(
      () => FeatureFlag.create(tenant, { key: "over-rollout", name: "Over", rolloutPercentage: 101 }),
      ValidationError,
    );
    const flag = FeatureFlag.create(tenant, { key: "empty-rule", name: "Empty" });
    assert.throws(() => flag.upsertRule({ conditions: [], value: true }), ValidationError);
    assert.throws(() => flag.removeRule("nope"), InvalidStateError);
  });

  it("archiving disables the flag and freezes it", () => {
    const flag = FeatureFlag.create(tenant, { key: "retired-flag", name: "Retired", enabled: true });
    flag.archive();
    assert.equal(flag.enabled, false);
    assert.throws(() => flag.toggle(true, "ada"), InvalidStateError);
    assert.throws(() => flag.update({ rolloutPercentage: 50 }), InvalidStateError);
  });
});

describe("feature flag service", () => {
  it("returns a safe default for an unknown or archived flag", async () => {
    const h = harness();
    await activeTenant(h);
    const { featureFlag } = h.container.services;

    const unknown = featureFlag.evaluate(h.tenantId, "never-created", { subject: "ada" });
    assert.deepEqual({ ...unknown }, { key: "never-created", value: false, reason: "default" });

    await featureFlag.create(h.admin, { key: "temporary", name: "Temporary", enabled: true });
    await featureFlag.archive(h.admin, "temporary");
    assert.equal(featureFlag.evaluate(h.tenantId, "temporary", { subject: "ada" }).value, false);
    await rejects(() => featureFlag.toggle(h.admin, "temporary", true));
  });

  it("bootstraps a client with one call", async () => {
    const h = harness();
    await activeTenant(h);
    const { featureFlag } = h.container.services;

    await featureFlag.create(h.admin, { key: "flag-one", name: "One", enabled: true, rolloutPercentage: 100 });
    await featureFlag.create(h.admin, { key: "flag-two", name: "Two", enabled: false });
    await featureFlag.create(h.admin, { key: "flag-three", name: "Three" });
    await featureFlag.archive(h.admin, "flag-three");

    const bulk = featureFlag.evaluateAll(h.tenantId, { subject: "ada" });
    assert.deepEqual(bulk.flags, { "flag-one": true, "flag-two": false });
    assert.equal(bulk.evaluatedAt, h.clock.now());
  });

  it("explains a decision without recording anything", async () => {
    const h = harness();
    await activeTenant(h);
    const { featureFlag, audit } = h.container.services;

    await featureFlag.create(h.admin, {
      key: "new-order-workspace",
      name: "New order workspace",
      enabled: true,
      rolloutPercentage: 25,
    });
    const before = audit.query(h.tenantId, {}).total;

    const explained = featureFlag.explain(h.tenantId, "new-order-workspace", { subject: "ada" });
    assert.equal(explained.rolloutPercentage, 25);
    assert.equal(explained.bucketOf, bucketFor("new-order-workspace", "ada"));
    assert.equal(audit.query(h.tenantId, {}).total, before, "explaining is a read");
  });

  it("projects the split of a rollout over a sample", async () => {
    const h = harness();
    await activeTenant(h);
    const { featureFlag } = h.container.services;

    await featureFlag.create(h.admin, {
      key: "half-rollout",
      name: "Half",
      enabled: true,
      rolloutPercentage: 50,
    });
    const subjects = Array.from({ length: 1_000 }, (_, i) => `user-${i}`);
    const projection = featureFlag.simulate(h.tenantId, "half-rollout", subjects);

    assert.equal(projection.total, 1_000);
    assert.equal(projection.on + projection.off, 1_000);
    assert.ok(
      projection.percentOn > 44 && projection.percentOn < 56,
      `expected roughly half, got ${projection.percentOn}%`,
    );
  });

  it("records who toggled a flag", async () => {
    const h = harness();
    await activeTenant(h);
    const { featureFlag, audit } = h.container.services;

    await featureFlag.create(h.admin, { key: "audited-flag", name: "Audited" });
    await featureFlag.toggle(h.admin, "audited-flag", true);

    const entries = audit.query(h.tenantId, { action: "feature-flag.toggle" });
    assert.equal(entries.total, 1);
    assert.equal(entries.items[0]?.actor, h.admin.actor);
    assert.equal(entries.items[0]?.resourceId, "audited-flag");
  });
});

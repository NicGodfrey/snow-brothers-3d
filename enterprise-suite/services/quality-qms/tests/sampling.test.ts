import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aqlSingleNormalPlan,
  codeLetterFor,
  determineSampling,
  validateSamplingRule,
} from "../src/domain/sampling.js";

test("code letters follow the lot-size table for general levels", () => {
  assert.equal(codeLetterFor(5, "II"), "A");
  assert.equal(codeLetterFor(50, "II"), "D");
  assert.equal(codeLetterFor(1000, "II"), "J");
  assert.equal(codeLetterFor(1000, "I"), "G");
  assert.equal(codeLetterFor(1000, "III"), "K");
  assert.equal(codeLetterFor(100_000, "II"), "N");
  assert.equal(codeLetterFor(600_000, "III"), "R");
});

test("AQL single/normal plans match published table values", () => {
  // Classic textbook case: lot 1000, level II -> code J (n=80)
  assert.deepEqual(aqlSingleNormalPlan(1000, "II", 1.0), {
    sampleSize: 80,
    acceptanceNumber: 2,
    codeLetter: "J",
  });
  assert.deepEqual(aqlSingleNormalPlan(1000, "II", 2.5), {
    sampleSize: 80,
    acceptanceNumber: 5,
    codeLetter: "J",
  });
  assert.deepEqual(aqlSingleNormalPlan(1000, "II", 0.65), {
    sampleSize: 80,
    acceptanceNumber: 1,
    codeLetter: "J",
  });
  // Lot 3000, level II -> K (n=125); AQL 1.0 -> Ac 3
  assert.deepEqual(aqlSingleNormalPlan(3000, "II", 1.0), {
    sampleSize: 125,
    acceptanceNumber: 3,
    codeLetter: "K",
  });
});

test("arrow-down above the Ac=0 row resolves to the Ac=0 plan", () => {
  // Lot 25, level II -> C (n=5); AQL 1.0 zero row is E (n=13)
  assert.deepEqual(aqlSingleNormalPlan(25, "II", 1.0), {
    sampleSize: 13,
    acceptanceNumber: 0,
    codeLetter: "E",
  });
});

test("arrow rows just below Ac=0 resolve to the Ac=1 plan", () => {
  // Lot 100, level II -> F (n=20); AQL 1.0: F is an arrow row -> H (n=50, Ac 1)
  assert.deepEqual(aqlSingleNormalPlan(100, "II", 1.0), {
    sampleSize: 50,
    acceptanceNumber: 1,
    codeLetter: "H",
  });
  // Lot 200, level II -> G (n=32): also an arrow row -> H
  assert.deepEqual(aqlSingleNormalPlan(200, "II", 1.0), {
    sampleSize: 50,
    acceptanceNumber: 1,
    codeLetter: "H",
  });
});

test("arrow-up past the Ac=21 row freezes at the Ac=21 plan", () => {
  // AQL 6.5: zero row A, Ac=21 at L (n=200). Huge lots stay at (200, 21).
  assert.deepEqual(aqlSingleNormalPlan(600_000, "II", 6.5), {
    sampleSize: 200,
    acceptanceNumber: 21,
    codeLetter: "L",
  });
});

test("AQL sampling switches to 100% when the sample exceeds the lot", () => {
  // Lot 10 at level II -> letter B; AQL 1.0 resolves to (13, 0) but 13 > 10.
  const outcome = determineSampling({ kind: "aql", level: "II", aql: 1.0 }, 10);
  assert.equal(outcome.sampleSize, 10);
  assert.equal(outcome.acceptanceNumber, 0);
  assert.match(outcome.description, /100% inspection/);
});

test("fixed sampling clamps to lot quantity", () => {
  const outcome = determineSampling({ kind: "fixed", sampleSize: 50 }, 20);
  assert.equal(outcome.sampleSize, 20);
});

test("percentage sampling applies ceil, min and max", () => {
  const outcome = determineSampling({ kind: "percentage", percent: 10, minimum: 5, maximum: 60 }, 430);
  assert.equal(outcome.sampleSize, 43);
  assert.equal(determineSampling({ kind: "percentage", percent: 1, minimum: 5 }, 100).sampleSize, 5);
  assert.equal(
    determineSampling({ kind: "percentage", percent: 50, minimum: 1, maximum: 60 }, 1000).sampleSize,
    60,
  );
});

test("full inspection samples the whole lot", () => {
  assert.equal(determineSampling({ kind: "full" }, 77).sampleSize, 77);
});

test("invalid rules and quantities are rejected", () => {
  assert.throws(() => determineSampling({ kind: "fixed", sampleSize: 0 }, 10));
  assert.throws(() => determineSampling({ kind: "full" }, 0));
  assert.throws(() => validateSamplingRule({ kind: "percentage", percent: 0, minimum: 1 }));
  assert.throws(() => validateSamplingRule({ kind: "percentage", percent: 10, minimum: 5, maximum: 2 }));
  assert.throws(() => validateSamplingRule({ kind: "fixed", sampleSize: 2.5 }));
});

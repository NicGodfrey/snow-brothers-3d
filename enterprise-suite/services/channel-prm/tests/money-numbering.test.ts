import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { money } from "@enterprise-suite/shared-kernel";
import {
  applyBps,
  deductBps,
  discountBpsOf,
  formatMoney,
  multiplyMoney,
  subtractMoney,
  sumMoney,
  weightMoney,
  zeroMoney,
} from "../src/domain/money-math.js";
import { formatNumber, isNumberOf, parseNumber } from "../src/domain/numbering.js";
import { expectThrows, usd } from "./helpers.js";

describe("channel money maths", () => {
  it("keeps every figure in one currency", () => {
    assert.deepEqual(sumMoney([usd(100), usd(250)]), usd(350));
    assert.deepEqual(sumMoney([], "USD"), zeroMoney("USD"));
    expectThrows(() => sumMoney([]), "VALIDATION", "without a currency");
    expectThrows(() => sumMoney([usd(100), money(100, "EUR")]), "CURRENCY_MISMATCH");
    expectThrows(() => subtractMoney(usd(100), money(10, "EUR")), "CURRENCY_MISMATCH");
  });

  it("applies basis points with a single half-up rounding step", () => {
    assert.deepEqual(applyBps(usd(1_000_000), 1_400), usd(140_000));
    assert.deepEqual(deductBps(usd(1_000_000), 1_400), usd(860_000));
    // 333 minor units at 5% rounds half up to 17, and the remainder is exact.
    assert.deepEqual(applyBps(usd(333), 500), usd(17));
    assert.deepEqual(deductBps(usd(333), 500), usd(316));
    expectThrows(() => applyBps(usd(100), 10_001), "VALIDATION", "between 0 and 10000");
    expectThrows(() => applyBps(usd(100), 12.5), "VALIDATION");
  });

  it("derives the effective discount and refuses to report an uplift", () => {
    assert.equal(discountBpsOf(usd(1_000_000), usd(860_000)), 1_400);
    assert.equal(discountBpsOf(usd(1_000_000), usd(1_000_000)), 0);
    assert.equal(discountBpsOf(usd(1_000_000), usd(1_200_000)), 0, "a net above list is not a negative discount");
    assert.equal(discountBpsOf(usd(0), usd(0)), 0);
  });

  it("weights pipeline value by probability", () => {
    assert.deepEqual(weightMoney(usd(1_000_000), 25), usd(250_000));
    assert.deepEqual(weightMoney(usd(1_000_001), 50), usd(500_001));
    assert.deepEqual(weightMoney(usd(1_000_000), 0), usd(0));
    expectThrows(() => weightMoney(usd(100), 120), "VALIDATION", "between 0 and 100");
  });

  it("multiplies line quantities and formats for humans", () => {
    assert.deepEqual(multiplyMoney(usd(1_200_000), 14), usd(16_800_000));
    assert.deepEqual(multiplyMoney(usd(333), 1.5), usd(500));
    expectThrows(() => multiplyMoney(usd(100), -1), "VALIDATION", "non-negative");
    assert.equal(formatMoney(usd(123_456)), "1234.56 USD");
    assert.equal(formatMoney(usd(-5)), "-0.05 USD");
  });
});

describe("document numbering", () => {
  it("formats short, zero-padded, per-kind numbers", () => {
    assert.equal(formatNumber("dealRegistration", 1), "DR-00001");
    assert.equal(formatNumber("conflict", 42), "CNF-00042");
    assert.equal(formatNumber("channelQuote", 123_456), "CQ-123456");
    expectThrows(() => formatNumber("referral", 0), "VALIDATION", "positive integer");
  });

  it("round-trips a number back to its sequence", () => {
    assert.deepEqual(parseNumber("dr-00007"), { sequence: "dealRegistration", value: 7 });
    assert.deepEqual(parseNumber("CO-00001"), { sequence: "channelOrder", value: 1 });
    assert.equal(parseNumber("XX-00001"), undefined);
    assert.equal(parseNumber("DR-7"), undefined);
    assert.equal(isNumberOf("referral", "REF-00003"), true);
    assert.equal(isNumberOf("referral", "DR-00003"), false);
  });
});

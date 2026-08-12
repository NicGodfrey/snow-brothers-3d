/**
 * The derived-metric expression language.
 *
 * The semantics that matter here are the SQL ones: null propagates, division
 * by zero is null rather than Infinity, and the namespace is closed. A tile
 * showing an empty cell for "no orders yet" is correct; one showing
 * `Infinity` or reaching a global is a bug.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExpressionError } from "../src/domain/errors.js";
import {
  evaluate,
  parseExpression,
  referencedNames,
  scopeOf,
  unparse,
  type MetricValue,
} from "../src/domain/expression.js";

function run(source: string, values: Record<string, MetricValue> = {}): MetricValue {
  return evaluate(parseExpression(source), scopeOf(values));
}

describe("parsing", () => {
  it("applies standard precedence and associativity", () => {
    assert.equal(run("2 + 3 * 4"), 14);
    assert.equal(run("(2 + 3) * 4"), 20);
    assert.equal(run("100 - 20 - 30"), 50);
    assert.equal(run("100 / 5 / 2"), 10);
    assert.equal(run("-3 + 10"), 7);
    assert.equal(run("--5"), 5);
  });

  it("reads decimals and underscore-separated literals", () => {
    assert.equal(run("1.5 * 2"), 3);
    assert.equal(run("1_000_000 / 1000"), 1000);
    assert.equal(run(".5 + .25"), 0.75);
  });

  it("round-trips through unparse", () => {
    const source = "safe_div(revenue - cogs, revenue) * 100";
    const once = unparse(parseExpression(source));
    assert.equal(unparse(parseExpression(once)), once);
  });

  it("rejects anything outside the grammar", () => {
    assert.throws(() => parseExpression(""), ExpressionError);
    assert.throws(() => parseExpression("revenue +"), ExpressionError);
    assert.throws(() => parseExpression("revenue) * 2"), ExpressionError);
    assert.throws(() => parseExpression("safe_div(1"), ExpressionError);
    assert.throws(() => parseExpression("revenue ^ 2"), ExpressionError);
    // Closed namespace: no member access, no calls into the host.
    assert.throws(() => parseExpression("process.exit(1)"), ExpressionError);
    assert.throws(() => parseExpression("revenue = 5"), ExpressionError);
  });

  it("rejects unknown functions and wrong arity with a usable message", () => {
    assert.throws(() => parseExpression("median(revenue)"), (error: unknown) => {
      assert.ok(error instanceof ExpressionError);
      assert.match(error.message, /unknown function 'median'/);
      assert.match(error.message, /safe_div/);
      return true;
    });
    assert.throws(() => parseExpression("safe_div(revenue)"), /takes 2 argument/);
    assert.throws(() => parseExpression("sqrt(1, 2)"), /takes 1 argument/);
  });
});

describe("evaluation", () => {
  it("propagates null through every operator", () => {
    const scope = { a: null, b: 10 };
    assert.equal(run("a + b", scope), null);
    assert.equal(run("a - b", scope), null);
    assert.equal(run("a * b", scope), null);
    assert.equal(run("a / b", scope), null);
    assert.equal(run("-a", scope), null);
  });

  it("returns null for division by zero rather than Infinity or NaN", () => {
    assert.equal(run("revenue / orders", { revenue: 500, orders: 0 }), null);
    assert.equal(run("safe_div(revenue, orders)", { revenue: 500, orders: 0 }), null);
    assert.equal(run("safe_div(0, 0)"), null);
  });

  it("supports the function library", () => {
    assert.equal(run("abs(-4)"), 4);
    assert.equal(run("coalesce(a, b, 0)", { a: null, b: null }), 0);
    assert.equal(run("least(3, 9, 5)"), 3);
    assert.equal(run("greatest(3, 9, 5)"), 9);
    assert.equal(run("pow(2, 10)"), 1024);
    assert.equal(run("round(3.14159, 2)"), 3.14);
    assert.equal(run("round(2.5)"), 3);
    assert.equal(run("sqrt(144)"), 12);
    // Domain errors come back as null, not NaN.
    assert.equal(run("sqrt(-1)"), null);
    // Aggregate-style functions ignore nulls but return null when all are null.
    assert.equal(run("greatest(a, 7)", { a: null }), 7);
    assert.equal(run("least(a, b)", { a: null, b: null }), null);
  });

  it("fails loudly on an unresolved reference", () => {
    assert.throws(() => run("revenue * 2", {}), (error: unknown) => {
      assert.ok(error instanceof ExpressionError);
      assert.match(error.message, /unresolved metric reference 'revenue'/);
      return true;
    });
    // A metric that exists but has no value for this group is null, not an error.
    assert.equal(run("revenue * 2", { revenue: null }), null);
  });
});

describe("analysis", () => {
  it("lists distinct references in first-seen order", () => {
    assert.deepEqual(
      referencedNames(parseExpression("safe_div(revenue - cogs, revenue) * margin_factor")),
      ["revenue", "cogs", "margin_factor"],
    );
  });

  it("treats literals and function names as non-references", () => {
    assert.deepEqual(referencedNames(parseExpression("round(100 * 2, 1)")), []);
  });
});

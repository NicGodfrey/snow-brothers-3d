import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  matchAnyTopic,
  matchTopic,
  parseTopic,
  parseTopicPattern,
  patternSpecificity,
  TopicPatternError,
  TopicRouter,
} from "../src/topic-pattern.js";

describe("topic pattern matching", () => {
  it("matches literal topics exactly", () => {
    assert.equal(matchTopic("quality.ncr.opened", "quality.ncr.opened"), true);
    assert.equal(matchTopic("quality.ncr.opened", "quality.ncr.closed"), false);
    assert.equal(matchTopic("quality.ncr", "quality.ncr.opened"), false);
    assert.equal(matchTopic("quality.ncr.opened", "quality.ncr"), false);
  });

  it("matches a single segment with *", () => {
    assert.equal(matchTopic("quality.*.opened", "quality.ncr.opened"), true);
    assert.equal(matchTopic("quality.*.opened", "quality.audit.opened"), true);
    assert.equal(matchTopic("quality.*.opened", "quality.ncr.line.opened"), false);
    assert.equal(matchTopic("*", "quality"), true);
    assert.equal(matchTopic("*", "quality.ncr"), false);
  });

  it("matches any number of segments with **", () => {
    assert.equal(matchTopic("quality.**", "quality.ncr.opened"), true);
    assert.equal(matchTopic("quality.**", "quality"), true, "trailing ** matches the empty tail");
    assert.equal(matchTopic("quality.**", "sales.order.placed"), false);
    assert.equal(matchTopic("**", "anything.at.all"), true);
    assert.equal(matchTopic("**.opened", "quality.ncr.opened"), true);
    assert.equal(matchTopic("quality.**.opened", "quality.ncr.severity.opened"), true);
    assert.equal(matchTopic("quality.**.opened", "quality.opened"), true);
    assert.equal(matchTopic("quality.**.opened", "quality.ncr.closed"), false);
  });

  it("combines wildcards", () => {
    assert.equal(matchTopic("*.ncr.**", "quality.ncr.containment.started"), true);
    assert.equal(matchTopic("*.ncr.**", "quality.capa.created"), false);
  });

  it("matches against a list of patterns", () => {
    const patterns = ["sales.order.**", "quality.ncr.opened"];
    assert.equal(matchAnyTopic(patterns, "sales.order.line.added"), true);
    assert.equal(matchAnyTopic(patterns, "quality.ncr.opened"), true);
    assert.equal(matchAnyTopic(patterns, "quality.ncr.closed"), false);
  });

  it("rejects malformed patterns and wildcard topics", () => {
    assert.throws(() => parseTopicPattern(""), TopicPatternError);
    assert.throws(() => parseTopicPattern("quality..ncr"), TopicPatternError);
    assert.throws(() => parseTopicPattern("quality.ncr."), TopicPatternError);
    assert.throws(() => parseTopicPattern("quality.n cr"), TopicPatternError);
    assert.throws(() => parseTopic("quality.*"), TopicPatternError);
    assert.deepEqual([...parseTopic("quality.ncr.opened")], ["quality", "ncr", "opened"]);
  });

  it("ranks specificity literal > single > multi", () => {
    assert.ok(
      patternSpecificity("quality.ncr.opened") > patternSpecificity("quality.*.opened"),
    );
    assert.ok(patternSpecificity("quality.*.opened") > patternSpecificity("quality.**"));
  });
});

describe("TopicRouter", () => {
  const router = new TopicRouter<string>();
  router.add("quality.ncr.opened", "exact");
  router.add("quality.*.opened", "single");
  router.add("quality.**", "prefix");
  router.add("**", "all");
  router.add("sales.order.placed", "sales");

  it("returns every matching value once, in insertion order", () => {
    assert.deepEqual(router.match("quality.ncr.opened"), ["exact", "single", "prefix", "all"]);
    assert.deepEqual(router.match("quality.capa.created"), ["prefix", "all"]);
    assert.deepEqual(router.match("sales.order.placed"), ["all", "sales"]);
    assert.deepEqual(router.match("hcm.employee.hired"), ["all"]);
  });

  it("agrees with matchTopic for every registered pattern", () => {
    const topics = ["quality.ncr.opened", "quality.capa.created", "sales.order.placed", "quality"];
    for (const topic of topics) {
      const bruteForce = router
        .entries()
        .filter((entry) => matchTopic(entry.pattern, topic))
        .map((entry) => entry.value);
      assert.deepEqual(new Set(router.match(topic)), new Set(bruteForce), topic);
    }
  });

  it("supports removal by pattern and by value", () => {
    const local = new TopicRouter<string>();
    local.add("a.b", "x");
    local.add("a.*", "x");
    local.add("a.b", "y");
    assert.equal(local.size, 3);

    assert.equal(local.remove("a.b", "y"), true);
    assert.equal(local.remove("a.b", "y"), false);
    assert.deepEqual(local.match("a.b"), ["x"]);

    assert.equal(local.removeValue("x"), 2);
    assert.equal(local.size, 0);
    assert.deepEqual(local.match("a.b"), []);
  });

  it("deduplicates a value registered under several matching patterns", () => {
    const local = new TopicRouter<string>();
    local.add("quality.**", "sub");
    local.add("quality.ncr.opened", "sub");
    assert.deepEqual(local.match("quality.ncr.opened"), ["sub"]);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyIntent } from "../src/intents.ts";

test("classifies game, code, policy, and meta questions", () => {
  assert.equal(classifyIntent("How does Stage 1 cheese quota work?"), "game");
  assert.equal(classifyIntent("Why does npm test fail to compile?"), "code");
  assert.equal(classifyIntent("Can we point lucy at cursor2api?"), "policy");
  assert.equal(classifyIntent("Show lucy17 agent id"), "meta");
  assert.equal(classifyIntent("What is 2+2?"), "general");
  assert.equal(classifyIntent("anything", "game"), "game");
});

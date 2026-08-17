import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyLucyLatency, wrapLucyChat } from "../src/lucy/prompt.ts";

test("short chat is fast; coding questions stay full", () => {
  assert.equal(classifyLucyLatency({ question: "你好" }), "fast");
  assert.equal(classifyLucyLatency({ question: "Reply with LIVE OK" }), "fast");
  assert.equal(
    classifyLucyLatency({ question: "read the readme and summarize" }),
    "full",
  );
  assert.equal(
    classifyLucyLatency({ question: "实现一个登录页" }),
    "full",
  );
  assert.equal(
    classifyLucyLatency({ question: "hi", imageCount: 1 }),
    "full",
  );
  assert.equal(
    classifyLucyLatency({ question: "hi", conversationMode: "plan" }),
    "full",
  );
  assert.equal(classifyLucyLatency({ question: "写很长的代码", fast: true }), "fast");
  assert.equal(classifyLucyLatency({ question: "hi", fast: false }), "full");
});

test("fast wrap forbids tools; full wrap still asks for speed", () => {
  const fast = wrapLucyChat("LIVE OK", "fast");
  assert.match(fast, /Do not use tools/);
  assert.match(fast, /QUESTION:\nLIVE OK/);
  const full = wrapLucyChat("fix the bug", "full");
  assert.match(full, /minimum tools/);
  assert.match(full, /Lead with the answer/);
});

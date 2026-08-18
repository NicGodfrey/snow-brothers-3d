export type LucyLatency = "fast" | "full";

const COMPLEX_RE =
  /```|实现|重构|修复|调试|查看代码|读一下|阅读|readme|implement\b|refactor\b|debug\b|write (code|a )|fix (the |this )?bug|pull request|\bcommit\b|read (the )?(file|readme)/i;

export function classifyLucyLatency(input: {
  question: string;
  fast?: boolean;
  imageCount?: number;
  conversationMode?: "agent" | "plan";
}): LucyLatency {
  if (input.fast === true) return "fast";
  if (input.fast === false) return "full";
  if ((input.imageCount ?? 0) > 0) return "full";
  if (input.conversationMode === "plan") return "full";
  const question = input.question.trim();
  if (question.length > 500) return "full";
  if (COMPLEX_RE.test(question)) return "full";
  return "fast";
}

export function wrapLucyChat(question: string, latency: LucyLatency): string {
  if (latency === "fast") {
    return [
      "Live chat turn. Answer immediately.",
      "Do not use tools, read files, search the repo, spawn subagents, commit, push, or open PRs.",
      "One short reply in the user's language. Lead with the answer. No preamble.",
      "",
      "QUESTION:",
      question,
    ].join("\n");
  }
  return [
    "Live chat turn. Lead with the answer in the first sentence.",
    "Use the minimum tools needed. Do not explore the whole repo. Do not spawn subagents.",
    "Do not commit, push, or open pull requests unless the question asks you to.",
    "Prefer speed: if you can answer from context, do that.",
    "",
    "QUESTION:",
    question,
  ].join("\n");
}

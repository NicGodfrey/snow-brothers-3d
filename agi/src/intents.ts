import type { Intent } from "./types.ts";

const RULES: Array<{ intent: Intent; pattern: RegExp }> = [
  {
    intent: "game",
    pattern:
      /\b(stage|cheese|cat|mouse|squeak|pounce|tile|dash|sneak|quota|arcade|crumb)\b/i,
  },
  {
    intent: "code",
    pattern:
      /\b(typescript|vite|bug|test|build|refactor|function|import|compile|lint)\b/i,
  },
  {
    intent: "policy",
    pattern:
      /\b(policy|secret|proxy|cursor2api|sub2api|new-api|unauthorized|legal)\b/i,
  },
  {
    intent: "meta",
    pattern:
      /\b(fleet|lucy\d*|agent id|concurrency|orchestrat|control plane|bc-)\b/i,
  },
];

export function classifyIntent(question: string, forced?: Intent): Intent {
  if (forced) return forced;
  for (const rule of RULES) {
    if (rule.pattern.test(question)) return rule.intent;
  }
  return "general";
}

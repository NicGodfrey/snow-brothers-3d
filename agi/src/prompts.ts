import type { ConversationMode, Intent, QaMode } from "./types.ts";

export function wrapQuestion(input: {
  slotName: string;
  question: string;
  mode: QaMode;
  intent: Intent;
  conversationMode?: ConversationMode;
  stance?: "affirm" | "deny";
}): string {
  const stance =
    input.stance === "affirm"
      ? "Argue FOR the proposition. Do not hedge into the opposite side."
      : input.stance === "deny"
        ? "Argue AGAINST the proposition. Do not hedge into the opposite side."
        : "Answer directly.";

  return [
    `You are ${input.slotName} on the Lucy 101-slot fleet.`,
    "This is a Q&A turn on the official Cursor Cloud Agents API.",
    "Do not git commit, git push, or open pull requests.",
    "Do not spawn subagents. Do not write files unless the question requires a code change.",
    `Intent: ${input.intent}. Mode: ${input.mode}. Conversation: ${input.conversationMode ?? "agent"}.`,
    stance,
    "Reply in concise prose. Lead with the answer.",
    "",
    "QUESTION:",
    input.question,
  ].join("\n");
}

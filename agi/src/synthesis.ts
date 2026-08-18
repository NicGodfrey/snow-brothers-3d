import type { Assignment } from "./types.ts";

export function synthesize(assignments: Assignment[]): string {
  const ok = assignments.filter((a) => a.status === "succeeded" && a.answer);
  if (ok.length === 0) return "No agent returned an answer.";
  if (ok.length === 1) return ok[0]!.answer!;

  const votes = new Map<string, string[]>();
  for (const a of ok) {
    const key = normalize(a.answer!);
    const list = votes.get(key) ?? [];
    list.push(a.slotName);
    votes.set(key, list);
  }
  const ranked = [...votes.entries()].sort((a, b) => b[1].length - a[1].length);
  const lines = [
    `Received ${ok.length} answers from ${assignments.length} assignments.`,
    `Majority cluster: ${ranked[0]![1].length}/${ok.length} (${ranked[0]![1].join(", ")}).`,
    "",
    ...ok.map((a) => `### ${a.slotName}\n${a.answer}`),
  ];
  return lines.join("\n");
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 240);
}

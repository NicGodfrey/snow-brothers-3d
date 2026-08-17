import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { LucySlot } from "./types.ts";

interface LucyCopiesFile {
  template: { name: string; agentId: string };
  copies: Array<{ name: string; agentId: string }>;
}

export function defaultLucyCopiesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../../data/lucy-copies.json");
}

export function loadLucyCopies(path = defaultLucyCopiesPath()): LucySlot[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as LucyCopiesFile;
  const slots: LucySlot[] = [
    {
      name: raw.template.name,
      agentId: raw.template.agentId,
      kind: "copy",
      status: "idle",
    },
  ];
  for (const copy of raw.copies) {
    slots.push({
      name: copy.name,
      agentId: copy.agentId,
      kind: "copy",
      status: "idle",
    });
  }
  return slots;
}

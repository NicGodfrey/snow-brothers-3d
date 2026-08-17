import { AgiError } from "./errors.ts";
import { classifyIntent } from "./intents.ts";
import { wrapQuestion } from "./prompts.ts";
import type { FleetRegistry } from "./registry.ts";
import type {
  AskRequest,
  Assignment,
  ConversationMode,
  FleetSlot,
  Intent,
  QaMode,
} from "./types.ts";

export interface RoutedJob {
  mode: QaMode;
  intent: Intent;
  question: string;
  assignments: Assignment[];
  prompts: Map<string, string>;
}

export function route(registry: FleetRegistry, request: AskRequest): RoutedJob {
  const question = request.question.trim();
  if (!question) throw new AgiError("empty_question", "Question is required");
  const mode = request.mode ?? "ask";
  const intent = classifyIntent(question, request.intent);
  const slots = pickSlots(registry, mode, request.target, request.n, intent);
  if (slots.length === 0) {
    throw new AgiError(
      "no_capacity",
      "No dispatchable fleet slots. Provision missing copies or wait for idle agents.",
      409,
    );
  }

  const prompts = new Map<string, string>();
  const assignments: Assignment[] = slots.map((slot, index) => {
    const stance =
      mode === "debate" ? (index === 0 ? "affirm" : "deny") : undefined;
    prompts.set(
      slot.name,
      wrapQuestion({
        slotName: slot.name,
        question,
        mode,
        intent,
        conversationMode: request.conversationMode,
        stance,
      }),
    );
    return {
      slotName: slot.name,
      agentId: slot.agentId!,
      status: "pending",
    };
  });

  return { mode, intent, question, assignments, prompts };
}

function pickSlots(
  registry: FleetRegistry,
  mode: QaMode,
  target: string | undefined,
  n: number | undefined,
  intent: Intent,
): FleetSlot[] {
  if (target) {
    const slot = registry.get(target);
    if (!slot.agentId || (slot.status !== "idle" && slot.status !== "busy")) {
      throw new AgiError(
        "slot_unavailable",
        `${target} is not dispatchable (${slot.status})`,
        409,
      );
    }
    return [slot];
  }

  const idle = registry.dispatchable();
  if (mode === "broadcast") return idle;
  if (mode === "debate") return registry.takeIdle(2);
  if (mode === "specialist") {
    if (intent === "meta") {
      const coordinator = idle.find((s) => s.role === "coordinator");
      if (coordinator) return [coordinator];
    }
    return registry.takeIdle(1);
  }

  const count = clamp(n ?? (mode === "ask" ? 1 : 8), 1, idle.length);
  return registry.takeIdle(count);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

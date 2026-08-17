import { AgiError } from "../errors.ts";
import type { FleetRegistry } from "../registry.ts";
import type { LucyKind, LucyPoolName, LucyPoolSnapshot, LucySlot } from "./types.ts";

export interface AcquireInput {
  pool: "copies" | "official";
  conversationId: string;
  target?: string;
}

export class LucyPool {
  readonly copies: LucySlot[];
  readonly conversations = new Map<string, { name: string; kind: LucyKind }>();

  constructor(
    copies: LucySlot[],
    private readonly registry: FleetRegistry,
    private readonly rng: () => number = Math.random,
  ) {
    this.copies = copies.map((s) => ({ ...s }));
  }

  idleCopies(): LucySlot[] {
    return this.copies.filter((s) => s.status === "idle");
  }

  idleOfficial(): LucySlot[] {
    return this.registry.dispatchable().map((s) => ({
      name: s.name,
      agentId: s.agentId!,
      kind: "official" as const,
      status: "idle" as const,
    }));
  }

  pickIdle(kind: LucyKind): LucySlot | null {
    const idle = kind === "copy" ? this.idleCopies() : this.idleOfficial();
    if (idle.length === 0) return null;
    const index = Math.min(idle.length - 1, Math.floor(this.rng() * idle.length));
    return idle[index] ?? null;
  }

  acquire(input: AcquireInput): LucySlot {
    if (input.pool === "official") return this.acquireOfficial(input);
    return this.acquireCopy(input);
  }

  release(name: string, kind: LucyKind): void {
    if (kind === "official") {
      const slot = this.registry.slots.find((s) => s.name === name);
      if (slot && slot.status === "busy") this.registry.mark(name, "idle");
      return;
    }
    const slot = this.copies.find((s) => s.name === name);
    if (slot && slot.status === "busy") slot.status = "idle";
  }

  snapshot(): LucyPoolSnapshot {
    const officialSlots = this.registry.slots.filter((s) => s.source === "official");
    return {
      copies: {
        total: this.copies.length,
        idle: this.idleCopies().length,
        busy: this.copies.filter((s) => s.status === "busy").length,
      },
      official: {
        total: officialSlots.length,
        idle: this.idleOfficial().length,
        busy: officialSlots.filter((s) => s.status === "busy").length,
      },
    };
  }

  resolvePool(
    requested: LucyPoolName | undefined,
    configured: LucyPoolName,
    transport: "official" | "mock",
  ): "copies" | "official" {
    const mode = requested ?? configured;
    if (mode === "copies" || mode === "official") return mode;
    if (transport === "mock") return "copies";
    if (this.idleOfficial().length > 0) return "official";
    return "copies";
  }

  private acquireCopy(input: AcquireInput): LucySlot {
    const pinned = this.conversations.get(input.conversationId);
    const name = input.target ?? (pinned?.kind === "copy" ? pinned.name : undefined);
    if (name) {
      const slot = this.copies.find((s) => s.name === name);
      if (!slot) throw new AgiError("unknown_lucy", `Unknown lucy ${name}`, 404);
      if (slot.status !== "idle") {
        throw new AgiError(
          input.target ? "lucy_busy" : "conversation_busy",
          `${name} is busy`,
          409,
        );
      }
      slot.status = "busy";
      this.conversations.set(input.conversationId, { name: slot.name, kind: "copy" });
      return slot;
    }
    const picked = this.pickIdle("copy");
    if (!picked) {
      throw new AgiError("no_idle_lucy", "No idle lucy copies are available", 503);
    }
    const slot = this.copies.find((s) => s.name === picked.name)!;
    slot.status = "busy";
    this.conversations.set(input.conversationId, { name: slot.name, kind: "copy" });
    return slot;
  }

  private acquireOfficial(input: AcquireInput): LucySlot {
    const pinned = this.conversations.get(input.conversationId);
    const name = input.target ?? (pinned?.kind === "official" ? pinned.name : undefined);
    if (name) {
      const slot = this.registry.get(name);
      if (!slot.agentId || slot.source !== "official") {
        throw new AgiError("unknown_lucy", `${name} is not an official lucy`, 404);
      }
      if (slot.status !== "idle") {
        throw new AgiError(
          input.target ? "lucy_busy" : "conversation_busy",
          `${name} is busy`,
          409,
        );
      }
      this.registry.mark(name, "busy");
      this.conversations.set(input.conversationId, { name, kind: "official" });
      return { name, agentId: slot.agentId, kind: "official", status: "busy" };
    }
    const picked = this.pickIdle("official");
    if (!picked) {
      throw new AgiError("no_idle_lucy", "No idle official lucys are available", 503);
    }
    this.registry.mark(picked.name, "busy");
    this.conversations.set(input.conversationId, {
      name: picked.name,
      kind: "official",
    });
    return { ...picked, status: "busy" };
  }
}

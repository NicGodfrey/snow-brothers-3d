import { AgiError } from "../errors.ts";
import type { FleetRegistry } from "../registry.ts";
import type { LucyKind, LucyPoolName, LucyPoolSnapshot, LucySlot } from "./types.ts";

export interface AcquireInput {
  pool: "copies" | "official";
  conversationId: string;
  target?: string;
  exclude?: string[];
}

export class LucyPool {
  readonly copies: LucySlot[];
  readonly conversations = new Map<string, { name: string; kind: LucyKind }>();
  readonly lastUsed = new Map<string, number>();

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

  pickIdle(kind: LucyKind, exclude: string[] = []): LucySlot | null {
    const blocked = new Set(exclude);
    const idle = (kind === "copy" ? this.idleCopies() : this.idleOfficial()).filter(
      (s) => !blocked.has(s.name) && !blocked.has(s.agentId),
    );
    if (idle.length === 0) return null;
    if (kind === "official") {
      const warm = idle
        .filter((s) => this.lastUsed.has(s.name))
        .sort(
          (a, b) => (this.lastUsed.get(b.name) ?? 0) - (this.lastUsed.get(a.name) ?? 0),
        );
      if (warm.length > 0) {
        const top = warm.slice(0, Math.min(3, warm.length));
        const index = Math.min(top.length - 1, Math.floor(this.rng() * top.length));
        return top[index] ?? warm[0] ?? null;
      }
    }
    const index = Math.min(idle.length - 1, Math.floor(this.rng() * idle.length));
    return idle[index] ?? null;
  }

  acquire(input: AcquireInput): LucySlot {
    if (input.pool === "official") return this.acquireOfficial(input);
    return this.acquireCopy(input);
  }

  release(name: string, kind: LucyKind): void {
    this.lastUsed.set(name, Date.now());
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
        warm: this.idleOfficial().filter((s) => this.lastUsed.has(s.name)).length,
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
    const picked = this.pickIdle("copy", input.exclude);
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
    const excluded = new Set(input.exclude ?? []);
    const pinnedName =
      pinned?.kind === "official" && !excluded.has(pinned.name)
        ? pinned.name
        : undefined;
    const name = input.target ?? pinnedName;
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
    const picked = this.pickIdle("official", input.exclude);
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

import { readFileSync } from "node:fs";
import { AgiError } from "./errors.ts";
import { buildSeedSlots } from "./seed.ts";
import type { FleetSlot, FleetSnapshot, TransportName } from "./types.ts";

export class FleetRegistry {
  readonly slots: FleetSlot[];
  private cursor = 0;

  constructor(slots?: FleetSlot[]) {
    this.slots = slots ? slots.map((s) => ({ ...s })) : buildSeedSlots();
    if (this.slots.length !== 101) {
      throw new AgiError(
        "fleet_size",
        `Fleet must have 101 slots, got ${this.slots.length}`,
        500,
      );
    }
  }

  static fromFile(path: string): FleetRegistry {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { slots: FleetSlot[] };
    return new FleetRegistry(raw.slots);
  }

  get(name: string): FleetSlot {
    const slot = this.slots.find((s) => s.name === name);
    if (!slot) throw new AgiError("unknown_slot", `Unknown slot ${name}`, 404);
    return slot;
  }

  byAgentId(id: string): FleetSlot | undefined {
    return this.slots.find((s) => s.agentId === id);
  }

  dispatchable(): FleetSlot[] {
    return this.slots.filter((s) => s.status === "idle" && Boolean(s.agentId));
  }

  takeIdle(count: number): FleetSlot[] {
    const idle = this.dispatchable();
    if (idle.length === 0 || count <= 0) return [];
    const out: FleetSlot[] = [];
    for (let i = 0; i < Math.min(count, idle.length); i += 1) {
      out.push(idle[this.cursor % idle.length]!);
      this.cursor += 1;
    }
    return out;
  }

  bind(name: string, agentId: string): FleetSlot {
    const slot = this.get(name);
    slot.agentId = agentId;
    slot.status = "idle";
    slot.url = `https://cursor.com/agents/${agentId}`;
    slot.notes = "Provisioned via official Cloud Agents API.";
    return slot;
  }

  mark(name: string, status: FleetSlot["status"], notes?: string): FleetSlot {
    const slot = this.get(name);
    slot.status = status;
    if (notes) slot.notes = notes;
    return slot;
  }

  snapshot(input: {
    transport: TransportName;
    maxInFlight: number;
    inFlight: number;
  }): FleetSnapshot {
    return {
      size: this.slots.length,
      dispatchable: this.dispatchable().length,
      unprovisioned: this.slots.filter((s) => s.status === "unprovisioned")
        .length,
      error: this.slots.filter((s) => s.status === "error").length,
      busy: this.slots.filter((s) => s.status === "busy").length,
      maxInFlight: input.maxInFlight,
      inFlight: input.inFlight,
      transport: input.transport,
      slots: this.slots.map((s) => ({ ...s })),
    };
  }
}

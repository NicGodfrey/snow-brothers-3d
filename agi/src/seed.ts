import type { FleetSlot, SlotSource } from "./types.ts";

interface KnownSlot {
  name: string;
  agentId: string;
  source: SlotSource;
  status: "idle" | "error";
}

/** Official API agents can take follow-up or be replaced on each fresh session. */
export const OFFICIAL_SLOTS: KnownSlot[] = [
  {
    name: "lucy02",
    agentId: "bc-1d069f7a-9bfc-46e9-a672-701aca214231",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy03",
    agentId: "bc-0958858d-3d17-490b-b6ef-2d3eda16f6fb",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy04",
    agentId: "bc-83b91fab-c4f7-46bd-b4b7-e4a531ce3621",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy11",
    agentId: "bc-9b5c3dd5-761c-4a9a-a25b-6a2df33846b3",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy12",
    agentId: "bc-bab955fc-000b-491c-8938-e436f109687b",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy13",
    agentId: "bc-6e79d4f0-577f-4f01-8a15-c7e1f4f9e3c8",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy14",
    agentId: "bc-1ad4ebf3-1c58-41d3-9ebb-fa4ed44f2b9c",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy15",
    agentId: "bc-0bc18de9-357a-442a-892c-f7a9a2a77bb6",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy16",
    agentId: "bc-beac2101-3d08-4f73-9543-48b4e867af5d",
    source: "official",
    status: "idle",
  },
  {
    name: "lucy18",
    agentId: "bc-ed9ea903-13e4-405a-9008-1908be444b0b",
    source: "official",
    status: "idle",
  },
];

/** Task-spawned copies: GET works, follow-up is legacy-workflow 400. */
export const LEGACY_SLOTS: KnownSlot[] = [
  {
    name: "lucy",
    agentId: "bc-9a1ae0da-1b80-5fe3-985e-94bc5ea1f3eb",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy01",
    agentId: "bc-b0b2da80-3f7a-5b8c-8662-8ff5fd6d7acf",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy05",
    agentId: "bc-63fc54fc-deda-5423-847f-aef6efb1fd10",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy06",
    agentId: "bc-4d152cbc-5a33-51d3-95ce-e687d05dcf80",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy07",
    agentId: "bc-5e026319-55aa-5b17-af10-da1f26853b32",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy08",
    agentId: "bc-cadf7e26-c8d6-516d-ad73-5128e92633cf",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy09",
    agentId: "bc-03576248-3f04-52d2-87e2-3ef29a321d99",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy10",
    agentId: "bc-a2317bdd-4573-5c72-82f0-90431209748b",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy17",
    agentId: "bc-1fb51db7-9e9a-5acd-92ce-aff6f90e0e77",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy19",
    agentId: "bc-34155fcd-9765-5d80-9e4f-8628454fb27f",
    source: "legacy",
    status: "error",
  },
  {
    name: "lucy20",
    agentId: "bc-50ff824a-b044-58b1-9b58-530d187cc583",
    source: "legacy",
    status: "error",
  },
];

export const KNOWN_SLOTS: KnownSlot[] = [...OFFICIAL_SLOTS, ...LEGACY_SLOTS];

export function slotName(index: number): string {
  if (index === 0) return "lucy";
  return `lucy${String(index).padStart(2, "0")}`;
}

export function buildSeedSlots(): FleetSlot[] {
  const known = new Map(KNOWN_SLOTS.map((s) => [s.name, s]));
  const slots: FleetSlot[] = [];
  for (let i = 0; i < 101; i += 1) {
    const name = slotName(i);
    const hit = known.get(name);
    if (hit) {
      slots.push({
        name,
        role: name === "lucy" ? "coordinator" : "worker",
        agentId: hit.agentId,
        status: hit.status,
        source: hit.source,
        url: `https://cursor.com/agents/${hit.agentId}`,
        notes:
          hit.source === "official"
            ? "Official Cloud Agents API agent. Fresh sessions archive the previous agent and create a new conversation."
            : "Task-spawned copy. Official follow-up is legacy-workflow 400. Not dispatchable.",
      });
      continue;
    }
    slots.push({
      name,
      role: "worker",
      agentId: null,
      status: "unprovisioned",
      source: "unprovisioned",
      url: null,
      notes: "Never created. Provision with POST /v1/fleet/provision.",
    });
  }
  return slots;
}

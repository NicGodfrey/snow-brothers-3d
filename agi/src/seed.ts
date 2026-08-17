import type { FleetSlot } from "./types.ts";

interface KnownSlot {
  name: string;
  agentId: string;
  status: "idle" | "error";
}

/** Live Task-spawned copies observed on 2026-08-17. ERROR rows are not dispatchable. */
export const KNOWN_SLOTS: KnownSlot[] = [
  {
    name: "lucy",
    agentId: "bc-9a1ae0da-1b80-5fe3-985e-94bc5ea1f3eb",
    status: "idle",
  },
  {
    name: "lucy01",
    agentId: "bc-b0b2da80-3f7a-5b8c-8662-8ff5fd6d7acf",
    status: "idle",
  },
  {
    name: "lucy02",
    agentId: "bc-1d069f7a-9bfc-46e9-a672-701aca214231",
    status: "idle",
  },
  {
    name: "lucy03",
    agentId: "bc-1fb606b8-13c3-508f-bda3-0bff67f2d35d",
    status: "error",
  },
  {
    name: "lucy04",
    agentId: "bc-6e5aae02-a2c7-5796-9c74-1f4e2f4ec9ba",
    status: "error",
  },
  {
    name: "lucy05",
    agentId: "bc-63fc54fc-deda-5423-847f-aef6efb1fd10",
    status: "idle",
  },
  {
    name: "lucy06",
    agentId: "bc-4d152cbc-5a33-51d3-95ce-e687d05dcf80",
    status: "idle",
  },
  {
    name: "lucy07",
    agentId: "bc-5e026319-55aa-5b17-af10-da1f26853b32",
    status: "idle",
  },
  {
    name: "lucy08",
    agentId: "bc-cadf7e26-c8d6-516d-ad73-5128e92633cf",
    status: "idle",
  },
  {
    name: "lucy09",
    agentId: "bc-03576248-3f04-52d2-87e2-3ef29a321d99",
    status: "idle",
  },
  {
    name: "lucy10",
    agentId: "bc-a2317bdd-4573-5c72-82f0-90431209748b",
    status: "idle",
  },
  {
    name: "lucy11",
    agentId: "bc-04e56e4a-2703-5c7f-9175-e162ac65d282",
    status: "error",
  },
  {
    name: "lucy12",
    agentId: "bc-8d593e93-4ed1-5493-a537-2591e0d32665",
    status: "error",
  },
  {
    name: "lucy13",
    agentId: "bc-8670f66d-c536-533a-9ae6-75a174fd91e5",
    status: "error",
  },
  {
    name: "lucy14",
    agentId: "bc-d4efe6e0-e8c3-5449-974a-00802b98c596",
    status: "error",
  },
  {
    name: "lucy15",
    agentId: "bc-7b15128f-4b88-5230-8003-8b04f5a95211",
    status: "error",
  },
  {
    name: "lucy16",
    agentId: "bc-c54a7f6c-2bb7-5bd3-a079-f0292327de35",
    status: "error",
  },
  {
    name: "lucy17",
    agentId: "bc-1fb51db7-9e9a-5acd-92ce-aff6f90e0e77",
    status: "idle",
  },
  {
    name: "lucy18",
    agentId: "bc-77b238c3-0be7-506d-820e-69214e6aae29",
    status: "error",
  },
  {
    name: "lucy19",
    agentId: "bc-34155fcd-9765-5d80-9e4f-8628454fb27f",
    status: "idle",
  },
  {
    name: "lucy20",
    agentId: "bc-50ff824a-b044-58b1-9b58-530d187cc583",
    status: "idle",
  },
];

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
        url: `https://cursor.com/agents/${hit.agentId}`,
        notes:
          hit.agentId === "bc-1d069f7a-9bfc-46e9-a672-701aca214231"
            ? "Official Cloud Agents API agent. Follow-up Q&A works."
            : hit.status === "error"
              ? "Task spawn failed at the async-10 cap. Not dispatchable until provisioned via official API."
              : "Task-spawned copy. Official GET works; follow-up runs fail with legacy-workflow 400. Provision a replacement.",
      });
      continue;
    }
    slots.push({
      name,
      role: "worker",
      agentId: null,
      status: "unprovisioned",
      url: null,
      notes: "Never created. Provision with POST /v1/fleet/provision.",
    });
  }
  return slots;
}

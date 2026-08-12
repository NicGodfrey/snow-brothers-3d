import type { StateMachineDef } from "../../kernel/index.js";

export type OpportunityStage =
  | "prospecting"
  | "qualification"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export const OPEN_STAGES: readonly OpportunityStage[] = [
  "prospecting",
  "qualification",
  "proposal",
  "negotiation",
];

/**
 * Open stages may move forward or backward among each other and may close
 * won/lost at any time. Closed stages are terminal.
 */
export const OPPORTUNITY_STAGE_MACHINE: StateMachineDef<OpportunityStage> = {
  name: "Opportunity",
  initial: "prospecting",
  transitions: {
    prospecting: ["qualification", "proposal", "negotiation", "closed_won", "closed_lost"],
    qualification: ["prospecting", "proposal", "negotiation", "closed_won", "closed_lost"],
    proposal: ["prospecting", "qualification", "negotiation", "closed_won", "closed_lost"],
    negotiation: ["prospecting", "qualification", "proposal", "closed_won", "closed_lost"],
    closed_won: [],
    closed_lost: [],
  },
};

export const STAGE_PROBABILITY: Readonly<Record<OpportunityStage, number>> = {
  prospecting: 10,
  qualification: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

export function isOpenStage(stage: OpportunityStage): boolean {
  return OPEN_STAGES.includes(stage);
}

export function nextStage(stage: OpportunityStage): OpportunityStage | undefined {
  const idx = OPEN_STAGES.indexOf(stage);
  if (idx === -1 || idx === OPEN_STAGES.length - 1) return undefined;
  return OPEN_STAGES[idx + 1];
}

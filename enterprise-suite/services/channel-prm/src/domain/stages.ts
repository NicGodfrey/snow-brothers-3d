import { InvalidStateError, ValidationError } from "./errors.js";

/**
 * Channel opportunity stages.
 *
 * These mirror the vendor's sales stages so partner-sourced pipeline can be
 * rolled up next to direct pipeline, but they live here because the channel
 * team owns the definition of "qualified" for partner deals (a partner cannot
 * self-declare a deal committed).
 */
export type ChannelStage =
  | "prospect"
  | "qualified"
  | "proposal"
  | "negotiation"
  | "closed_won"
  | "closed_lost";

export const CHANNEL_STAGES: readonly ChannelStage[] = [
  "prospect",
  "qualified",
  "proposal",
  "negotiation",
  "closed_won",
  "closed_lost",
];

export const OPEN_STAGES: readonly ChannelStage[] = ["prospect", "qualified", "proposal", "negotiation"];

/** Default win probability per stage, in percent. Overridable per deal. */
export const STAGE_DEFAULT_PROBABILITY: Readonly<Record<ChannelStage, number>> = {
  prospect: 10,
  qualified: 25,
  proposal: 50,
  negotiation: 75,
  closed_won: 100,
  closed_lost: 0,
};

/** Rank used to tell "moved forward" from "slipped back". */
export const STAGE_ORDER: Readonly<Record<ChannelStage, number>> = {
  prospect: 0,
  qualified: 1,
  proposal: 2,
  negotiation: 3,
  closed_won: 4,
  closed_lost: 4,
};

export type ForecastCategory = "omitted" | "pipeline" | "best_case" | "commit" | "closed_won" | "closed_lost";

export function isChannelStage(value: string): value is ChannelStage {
  return (CHANNEL_STAGES as readonly string[]).includes(value);
}

export function isOpenStage(stage: ChannelStage): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage);
}

export function isTerminalStage(stage: ChannelStage): boolean {
  return stage === "closed_won" || stage === "closed_lost";
}

/**
 * Forecast category from stage + probability.
 *
 * Probability wins over stage for open deals: a negotiation-stage deal a
 * channel manager marked down to 20% belongs in pipeline, not commit. Deals
 * below 5% are omitted from every roll-up.
 */
export function forecastCategoryFor(stage: ChannelStage, probability: number): ForecastCategory {
  if (stage === "closed_won") return "closed_won";
  if (stage === "closed_lost") return "closed_lost";
  if (probability < 5) return "omitted";
  if (probability >= 70) return "commit";
  if (probability >= 40) return "best_case";
  return "pipeline";
}

export function assertProbability(probability: number): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 100) {
    throw ValidationError.single("probability", "must be between 0 and 100");
  }
  return Math.round(probability);
}

/**
 * Stage transitions. Open stages may move freely in both directions (deals
 * slip), terminal stages are only reachable from an open stage and are final —
 * a lost deal is re-registered, never resurrected.
 */
export function assertStageTransition(from: ChannelStage, to: ChannelStage): void {
  if (from === to) return;
  if (isTerminalStage(from)) {
    throw new InvalidStateError(`Stage ${from} is terminal; cannot move to ${to}`, { from, to });
  }
  if (!isChannelStage(to)) {
    throw ValidationError.single("stage", `unknown stage "${to}"`);
  }
}

/** Stages an aging report treats as "stalled" when untouched for too long. */
export const STALL_THRESHOLD_DAYS: Readonly<Record<ChannelStage, number>> = {
  prospect: 30,
  qualified: 30,
  proposal: 21,
  negotiation: 14,
  closed_won: Number.POSITIVE_INFINITY,
  closed_lost: Number.POSITIVE_INFINITY,
};

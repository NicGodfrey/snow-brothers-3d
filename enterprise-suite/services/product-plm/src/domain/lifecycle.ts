import { InvalidStateError } from "./errors.js";

/**
 * Product lifecycle.
 *
 *   design -> pilot -> active -> end_of_life
 *
 * `pilot -> design` is the only backward transition (a pilot run that failed
 * validation goes back to the drawing board). Once a product is active the
 * only way out is end-of-life; there is no un-launching.
 */

export type LifecycleState = "design" | "pilot" | "active" | "end_of_life";

export const LIFECYCLE_STATES: readonly LifecycleState[] = [
  "design",
  "pilot",
  "active",
  "end_of_life",
];

const ALLOWED: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  design: ["pilot"],
  pilot: ["active", "design"],
  active: ["end_of_life"],
  end_of_life: [],
};

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}

export function canTransition(from: LifecycleState, to: LifecycleState): boolean {
  return ALLOWED[from].includes(to);
}

export function allowedTransitions(from: LifecycleState): readonly LifecycleState[] {
  return ALLOWED[from];
}

export function assertTransition(from: LifecycleState, to: LifecycleState): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateError(`Illegal lifecycle transition ${from} -> ${to}`, {
      from,
      to,
      allowed: ALLOWED[from],
    });
  }
}

/** States in which the product may still be structurally edited. */
export function isEditable(state: LifecycleState): boolean {
  return state === "design" || state === "pilot";
}

/** States in which the product can be sold / planned / manufactured. */
export function isSellable(state: LifecycleState): boolean {
  return state === "active";
}

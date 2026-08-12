/**
 * Minimal declarative state machine used by every workflow aggregate
 * (inspection lot, NCR, CAPA, audit, supplier quality event).
 *
 * Transitions are described as `from -> to` pairs with an optional guard.
 * Guards return a human-readable string when the transition is blocked;
 * `undefined` means the transition is allowed. This keeps workflow rules
 * in one auditable table per aggregate instead of scattered `if`s.
 */
import { ConflictError } from "@enterprise-suite/shared-kernel";

export interface TransitionDef<TState extends string, TSubject> {
  readonly from: TState | readonly TState[];
  readonly to: TState;
  /** Returns a rejection reason, or undefined when allowed. */
  readonly guard?: (subject: TSubject) => string | undefined;
}

export class StateMachine<TState extends string, TSubject> {
  constructor(
    private readonly aggregateName: string,
    private readonly transitions: readonly TransitionDef<TState, TSubject>[],
    private readonly terminalStates: readonly TState[] = [],
  ) {}

  /**
   * Validates the transition and returns the target state.
   * Throws ConflictError (HTTP 409) when the move is illegal.
   */
  assertTransition(current: TState, to: TState, subject: TSubject): TState {
    if (this.terminalStates.includes(current)) {
      throw new ConflictError(
        `${this.aggregateName} is in terminal state '${current}' and cannot transition to '${to}'`,
      );
    }
    const def = this.transitions.find(
      (t) => t.to === to && (Array.isArray(t.from) ? t.from.includes(current) : t.from === current),
    );
    if (!def) {
      throw new ConflictError(
        `${this.aggregateName} cannot transition from '${current}' to '${to}'`,
      );
    }
    if (def.guard) {
      const blocked = def.guard(subject);
      if (blocked) {
        throw new ConflictError(
          `${this.aggregateName} transition '${current}' -> '${to}' blocked: ${blocked}`,
        );
      }
    }
    return to;
  }

  canTransition(current: TState, to: TState, subject: TSubject): boolean {
    try {
      this.assertTransition(current, to, subject);
      return true;
    } catch {
      return false;
    }
  }

  reachableFrom(current: TState, subject: TSubject): TState[] {
    const targets = new Set<TState>();
    for (const t of this.transitions) {
      const fromMatches = Array.isArray(t.from) ? t.from.includes(current) : t.from === current;
      if (fromMatches && this.canTransition(current, t.to, subject)) targets.add(t.to);
    }
    return [...targets];
  }
}

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
export class StateMachine {
    aggregateName;
    transitions;
    terminalStates;
    constructor(aggregateName, transitions, terminalStates = []) {
        this.aggregateName = aggregateName;
        this.transitions = transitions;
        this.terminalStates = terminalStates;
    }
    /**
     * Validates the transition and returns the target state.
     * Throws ConflictError (HTTP 409) when the move is illegal.
     */
    assertTransition(current, to, subject) {
        if (this.terminalStates.includes(current)) {
            throw new ConflictError(`${this.aggregateName} is in terminal state '${current}' and cannot transition to '${to}'`);
        }
        const def = this.transitions.find((t) => t.to === to && (Array.isArray(t.from) ? t.from.includes(current) : t.from === current));
        if (!def) {
            throw new ConflictError(`${this.aggregateName} cannot transition from '${current}' to '${to}'`);
        }
        if (def.guard) {
            const blocked = def.guard(subject);
            if (blocked) {
                throw new ConflictError(`${this.aggregateName} transition '${current}' -> '${to}' blocked: ${blocked}`);
            }
        }
        return to;
    }
    canTransition(current, to, subject) {
        try {
            this.assertTransition(current, to, subject);
            return true;
        }
        catch {
            return false;
        }
    }
    reachableFrom(current, subject) {
        const targets = new Set();
        for (const t of this.transitions) {
            const fromMatches = Array.isArray(t.from) ? t.from.includes(current) : t.from === current;
            if (fromMatches && this.canTransition(current, t.to, subject))
                targets.add(t.to);
        }
        return [...targets];
    }
}
//# sourceMappingURL=state-machine.js.map
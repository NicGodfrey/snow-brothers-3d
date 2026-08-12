import { InvalidTransitionError } from "./errors.js";

export interface StateMachineDef<S extends string> {
  readonly name: string;
  readonly initial: S;
  readonly transitions: Readonly<Record<S, readonly S[]>>;
}

export function canTransition<S extends string>(def: StateMachineDef<S>, from: S, to: S): boolean {
  return def.transitions[from].includes(to);
}

export function assertTransition<S extends string>(def: StateMachineDef<S>, from: S, to: S): void {
  if (!canTransition(def, from, to)) {
    throw new InvalidTransitionError(def.name, from, to);
  }
}

export function isTerminal<S extends string>(def: StateMachineDef<S>, state: S): boolean {
  return def.transitions[state].length === 0;
}

export function reachableStates<S extends string>(def: StateMachineDef<S>, from: S): readonly S[] {
  const seen = new Set<S>([from]);
  const queue: S[] = [from];
  while (queue.length > 0) {
    const current = queue.shift() as S;
    for (const next of def.transitions[current]) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  seen.delete(from);
  return [...seen];
}

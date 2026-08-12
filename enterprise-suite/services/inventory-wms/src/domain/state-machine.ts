import { ConflictError } from "@enterprise-suite/shared-kernel";

export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/**
 * Guard for aggregate status transitions. Every stateful aggregate in this
 * context declares its legal transitions as data so the machine is auditable
 * in one place and violations fail with a 409 rather than corrupting state.
 */
export function assertTransition<S extends string>(
  subject: string,
  map: TransitionMap<S>,
  from: S,
  to: S,
): void {
  const allowed = map[from] ?? [];
  if (!allowed.includes(to)) {
    throw new ConflictError(
      `${subject}: illegal status transition ${from} -> ${to} (allowed: ${allowed.join(", ") || "none"})`,
    );
  }
}

export function canTransition<S extends string>(map: TransitionMap<S>, from: S, to: S): boolean {
  return (map[from] ?? []).includes(to);
}

/** Terminal states have no outgoing transitions. */
export function isTerminal<S extends string>(map: TransitionMap<S>, state: S): boolean {
  return (map[state] ?? []).length === 0;
}

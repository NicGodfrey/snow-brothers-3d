export interface TransitionDef<TState extends string, TSubject> {
    readonly from: TState | readonly TState[];
    readonly to: TState;
    /** Returns a rejection reason, or undefined when allowed. */
    readonly guard?: (subject: TSubject) => string | undefined;
}
export declare class StateMachine<TState extends string, TSubject> {
    private readonly aggregateName;
    private readonly transitions;
    private readonly terminalStates;
    constructor(aggregateName: string, transitions: readonly TransitionDef<TState, TSubject>[], terminalStates?: readonly TState[]);
    /**
     * Validates the transition and returns the target state.
     * Throws ConflictError (HTTP 409) when the move is illegal.
     */
    assertTransition(current: TState, to: TState, subject: TSubject): TState;
    canTransition(current: TState, to: TState, subject: TSubject): boolean;
    reachableFrom(current: TState, subject: TSubject): TState[];
}
//# sourceMappingURL=state-machine.d.ts.map
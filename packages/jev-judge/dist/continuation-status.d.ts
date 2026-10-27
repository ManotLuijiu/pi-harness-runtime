/**
 * The lifecycle of a continuation that the harness dispatched.
 *
 * A continuation is a turn that the harness started itself. While that
 * turn runs, the status says so: a timer that clears the status while the
 * agent is still working would claim that nothing runs any more.
 *
 * The gate is the only thing that decides whether a continuation is still
 * pending, so it can be read and tested without a session.
 */
export declare class ContinuationGate {
    private inFlight;
    /**
     * A continuation was dispatched.
     *
     * The status stays "RUN" from here until the turn settles.
     */
    begin(): void;
    /**
     * The turn settled.
     *
     * @returns True when a continuation was still pending, so the caller
     *   has to clear the status. False when there was nothing to clear.
     */
    settle(): boolean;
    /**
     * Whether a continuation is still running.
     */
    get pending(): boolean;
}
//# sourceMappingURL=continuation-status.d.ts.map
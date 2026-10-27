/**
 * The validation gate of the workflow.
 *
 * The workflow does not know how the tests are run: the task author declares
 * the tiers in the metadata of the todo item and the runs are recorded in a
 * ledger. This module only reads the *result* of that ledger, so the phase
 * gate and the ledger can never disagree about whether a tier passed.
 *
 * The shape of the state is mirrored here on purpose: the workflow must not
 * depend on the judge package, so the caller adapts its ledger to this
 * shape.
 */
/** The part of a todo item the gate needs. */
export interface GateTodo {
    id?: number;
    subject?: string;
    status?: string;
    metadata?: Record<string, unknown>;
}
/**
 * The validation state of the test items of a session.
 */
export interface ValidationGateState {
    /** Could the validation state be read at all? */
    available: boolean;
    /** Why the state could not be read. */
    reason?: string;
    /** Test items whose required final tier has not passed yet. */
    pendingFinalTier: number;
    /** Test items whose final tier failed, timed out or errored. */
    failedFinalTier: number;
    /** Test items whose plan requires a final tier but declares none. */
    incompletePlan: number;
    /** Test items whose plan declares a large job but no measured pilot. */
    missingPilot?: number;
}
/** Reads the validation state of the test items of a session. */
export type ValidationGateReader = (todos: GateTodo[]) => Promise<ValidationGateState>;
/** A gate state that says nothing. */
export declare function emptyValidationGateState(): ValidationGateState;
/**
 * Is the validation of the test items done?
 *
 * A gate that could not be read is not satisfied: the workflow must never
 * report a test as passed because it does not know how it went.
 */
export declare function validationGateSatisfied(state: ValidationGateState): boolean;
/**
 * A short description of the gate, for the status line and the instruction.
 */
export declare function describeValidationGate(state: ValidationGateState): string;
//# sourceMappingURL=validation.d.ts.map
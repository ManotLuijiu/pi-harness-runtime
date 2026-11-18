/**
 * The tracker of the exploration of a request.
 *
 * The tracker is the seam between the observations and the decision. It
 * owns the state of one request, it counts the reads, it recognises the
 * repetitions, and it decides whether the guard says something.
 *
 * The tracker never sends anything and never authorises anything: it
 * returns the text that the caller may show, and the caller decides.
 */
import { type Intervention } from "./budget.js";
import { type CheckpointInput } from "./checkpoint.js";
import { type ToolCallEnd, type ToolCallInput } from "./observation.js";
import { ExplorationStateStore } from "./state.js";
import type { ExplorationBudget, ExplorationKey, ExplorationPhase, ExplorationState } from "./types.js";
/**
 * The options of the tracker.
 */
export interface ExplorationTrackerOptions {
    /** The budget of the exploration. */
    budget?: ExplorationBudget;
    /** The store the states live in. */
    store?: ExplorationStateStore;
    /** The clock, so a test can pin the time. */
    now?: () => number;
}
/**
 * The result of an observed tool call.
 */
export interface ObservationResult {
    /** The state after the observation. */
    state: ExplorationState;
    /** The decision of the guard after the observation. */
    intervention: Intervention;
    /**
     * True when the guard has something to say that it did not say yet.
     *
     * The guard speaks once per request and checkpoint revision, so a
     * hundred parallel reads do not produce a hundred reminders.
     */
    shouldSpeak: boolean;
}
/**
 * The tracker of the exploration of a request.
 */
export declare class ExplorationTracker {
    private readonly store;
    private readonly budget;
    private readonly now;
    /**
     * The states of the requests this tracker owns.
     *
     * The tracker keeps the state of a request in memory, so a hundred
     * reads of one request do not read the file a hundred times. The file
     * is the durable copy, and it is written on every observation.
     */
    private readonly cache;
    constructor(options?: ExplorationTrackerOptions);
    /**
     * The state of a request.
     *
     * A request that was never seen has a fresh state. A request whose
     * state cannot be read is an error: it must not be mistaken for a
     * fresh request.
     */
    state(key: ExplorationKey): ExplorationState;
    /**
     * Observe a tool call and its result.
     *
     * A failed read observed nothing, and a tool the guard does not know
     * says nothing about the coverage of a file.
     */
    observe(key: ExplorationKey, call: ToolCallInput, end?: ToolCallEnd): ObservationResult;
    /**
     * Apply one observation to the state.
     */
    private applyObservation;
    /**
     * True when the guard has to speak.
     *
     * The guard speaks once per checkpoint revision and seriousness: a
     * batch of parallel reads produces one reminder and not one per file.
     *
     * The seriousness is part of the identity of an intervention. A warning
     * that was delivered does not silence a budget that is reached later in
     * the same checkpoint: the agent has to hear that the budget is gone.
     */
    private shouldSpeak;
    /**
     * Mark the guard as having spoken.
     *
     * The guard speaks again when the checkpoint of the agent changes, or
     * when the seriousness of the intervention grows. The seriousness is
     * remembered as it was, not as the largest one ever seen: a request
     * that answered a budget warning with a checkpoint may run into a soft
     * warning again, and that warning has to be heard too.
     */
    markSpoken(state: ExplorationState, severity: number): void;
    /**
     * The checkpoint of the agent, merged into the state.
     */
    recordCheckpoint(key: ExplorationKey, input: CheckpointInput): ExplorationState;
    /**
     * The text that the agent receives after a compaction.
     */
    continuationText(key: ExplorationKey): string;
    /**
     * The status of the exploration.
     */
    status(key: ExplorationKey): string;
    /**
     * Persist the state of a request.
     */
    save(key: ExplorationKey, state: ExplorationState): ExplorationState;
    /**
     * The phase of a request.
     */
    static phaseOf(value: string): ExplorationPhase;
}
//# sourceMappingURL=tracker.d.ts.map
/**
 * The budget of the exploration and the intervention of the guard.
 *
 * The guard starts with a warning. It never blocks the access to the source
 * and it never forces an edit: an investigation that needs more reads than
 * the default has to be able to say why, and the answer is recorded.
 *
 * The thresholds are configuration. A large investigation needs more than a
 * small one, and the deployment chooses the values from its own traces.
 */
import type { ExplorationBudget, ExplorationState, FileCoverage, InspectedRange } from "./types.js";
/**
 * The default budget.
 *
 * The values are deliberately generous: the guard observes first, and the
 * deployment tightens them when the traces show that they are wrong. Zero
 * disables a warning.
 */
export declare const DEFAULT_EXPLORATION_BUDGET: ExplorationBudget;
/**
 * Why the guard intervened.
 */
export type InterventionKind = "none" | "repeat-read" | "stall" | "read-budget" | "token-budget" | "time-budget" | "blocked";
/**
 * What the guard decided.
 */
export interface Intervention {
    /** What the guard decided. */
    kind: InterventionKind;
    /** The paths the decision is about. */
    paths: string[];
    /** The text the agent receives, empty when there is nothing to say. */
    message: string;
    /**
     * True when the guard asks the agent to record a checkpoint before it
     * continues.
     */
    requiresCheckpoint: boolean;
    /**
     * True when the guard asks the agent to implement the smallest justified
     * change.
     */
    suggestsImplementation: boolean;
}
/**
 * The continuation the agent receives after the guard intervened.
 *
 * The text asks for the checkpoint and the smallest justified change, and
 * it does not authorise anything: a commit, a push and a build stay outside
 * the decision of the guard.
 */
export declare const EXPLORATION_CONTINUATION_TEXT = "Reuse the recorded findings for this request. Read further only to resolve a specific remaining question. If sufficient evidence exists, implement the smallest justified change. Preserve phase order and required validation. Do not restart broad repository discovery or begin unrelated backlog work.";
/**
 * The request of a checkpoint.
 */
export declare const CHECKPOINT_REQUEST_TEXT = "Record the exploration checkpoint of this request: the findings with their source locations, the hypotheses that were narrowed or ruled out, the questions that are still open, and the next concrete action. A checkpoint is not a proof that every relevant file was read.";
/**
 * True when the range is already covered.
 *
 * A range is covered when it lies inside a range that was already
 * inspected. A truncated range covers only its own part, so it never
 * covers a range that reaches beyond it.
 */
export declare function rangeCovered(ranges: InspectedRange[], candidate: InspectedRange): boolean;
/**
 * The coverage of a file after one more read.
 *
 * The result says whether the read repeated a range that was already
 * covered. A read of a range that reaches beyond the covered one is not a
 * repetition: it brought new lines.
 */
export declare function classifyRepeat(coverage: FileCoverage, candidate: InspectedRange | undefined): "repeat" | "new" | "unknown";
/**
 * The number of reads of the request since the last narrowing.
 *
 * A narrowing is a hypothesis that was recorded, a finding that was
 * recorded, or a question that was answered. A cosmetic change does not
 * count: the count only falls when the agent said something about the
 * problem.
 */
export declare function readsSinceNarrowing(state: ExplorationState): number;
/**
 * True when the agent made progress that is not an edit.
 *
 * Reproducing a bug, narrowing a cause, ruling out a hypothesis and
 * mapping an interface are progress. Creating an empty checkpoint or
 * renaming a todo is not: a checkpoint with nothing in it is not progress.
 */
export declare function hasSubstantiveProgress(state: ExplorationState): boolean;
/**
 * The paths of the files that were read more than once.
 */
export declare function repeatedPaths(state: ExplorationState): string[];
/**
 * The decision of the guard.
 *
 * The decision is a pure function of the state and the budget, so it can be
 * tested without a session and without a model.
 */
export declare function assessExploration(state: ExplorationState, budget?: ExplorationBudget): Intervention;
/**
 * True when the intervention is one that has to be shown to the agent.
 */
export declare function isVisibleIntervention(intervention: Intervention): boolean;
//# sourceMappingURL=budget.d.ts.map
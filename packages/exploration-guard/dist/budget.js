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
/**
 * The default budget.
 *
 * The values are deliberately generous: the guard observes first, and the
 * deployment tightens them when the traces show that they are wrong. Zero
 * disables a warning.
 */
export const DEFAULT_EXPLORATION_BUDGET = {
    readWarning: 40,
    readBudget: 120,
    stallWarning: 12,
    tokenWarning: 120_000,
    timeWarningMs: 10 * 60_000,
    repeatWarning: 3,
};
/**
 * How serious an intervention is.
 *
 * A soft warning is the least serious, a budget that is reached is more
 * serious, and a blocker is the most serious.
 */
const SEVERITY = {
    none: 0,
    "repeat-read": 1,
    stall: 1,
    "read-budget": 2,
    "token-budget": 2,
    "time-budget": 2,
    blocked: 3,
};
/**
 * The seriousness of an intervention.
 *
 * The number is what decides whether the guard may speak again: a warning
 * that was delivered does not silence a budget that is reached later in the
 * same checkpoint.
 */
export function interventionSeverity(kind) {
    return SEVERITY[kind] ?? 0;
}
/**
 * The continuation the agent receives after the guard intervened.
 *
 * The text asks for the checkpoint and the smallest justified change, and
 * it does not authorise anything: a commit, a push and a build stay outside
 * the decision of the guard.
 */
export const EXPLORATION_CONTINUATION_TEXT = "Reuse the recorded findings for this request. Read further only to resolve a specific remaining question. If sufficient evidence exists, implement the smallest justified change. Preserve phase order and required validation. Do not restart broad repository discovery or begin unrelated backlog work.";
/**
 * The request of a checkpoint.
 */
export const CHECKPOINT_REQUEST_TEXT = "Record the exploration checkpoint of this request: the findings with their source locations, the hypotheses that were narrowed or ruled out, the questions that are still open, and the next concrete action. A checkpoint is not a proof that every relevant file was read.";
/**
 * True when the range is already covered.
 *
 * A range is covered when it lies inside a range that was already
 * inspected. A truncated range covers only its own part, so it never
 * covers a range that reaches beyond it.
 */
export function rangeCovered(ranges, candidate) {
    return ranges.some((range) => {
        if (range.truncated) {
            return candidate.start >= range.start && candidate.end <= range.end;
        }
        return candidate.start >= range.start && candidate.end <= range.end;
    });
}
/**
 * The coverage of a file after one more read.
 *
 * The result says whether the read repeated a range that was already
 * covered. A read of a range that reaches beyond the covered one is not a
 * repetition: it brought new lines.
 */
export function classifyRepeat(coverage, candidate) {
    if (!candidate)
        return "unknown";
    return rangeCovered(coverage.ranges, candidate) ? "repeat" : "new";
}
/**
 * The number of reads of the request since the last narrowing.
 *
 * A narrowing is a hypothesis that was recorded, a finding that was
 * recorded, or a question that was answered. A cosmetic change does not
 * count: the count only falls when the agent said something about the
 * problem.
 */
export function readsSinceNarrowing(state) {
    const narrowings = Math.max(state.checkpoint.findings.length, state.checkpoint.hypotheses.length);
    if (narrowings === 0)
        return state.readCount;
    // The narrowings do not carry a read count, so the count is approximated
    // by the number of reads that happened since the record was written.
    return Math.max(0, state.readCount - narrowings);
}
/**
 * True when the agent made progress that is not an edit.
 *
 * Reproducing a bug, narrowing a cause, ruling out a hypothesis and
 * mapping an interface are progress. Creating an empty checkpoint or
 * renaming a todo is not: a checkpoint with nothing in it is not progress.
 */
export function hasSubstantiveProgress(state) {
    if (state.checkpoint.findings.length > 0)
        return true;
    if (state.checkpoint.hypotheses.length > 0)
        return true;
    return false;
}
/**
 * The paths of the files that were read more than once.
 */
export function repeatedPaths(state) {
    return state.files
        .filter((file) => file.repeatCount > 0)
        .map((file) => file.path);
}
/**
 * The decision of the guard.
 *
 * The decision is a pure function of the state and the budget, so it can be
 * tested without a session and without a model.
 *
 * The branches are ordered by seriousness, not by the order in which they
 * were written. The guard says the strongest thing it knows: a request that
 * reached the read budget must not be told about a stall instead, because
 * the stall is the weaker warning and the agent would hear that the budget
 * is still far away. The seriousness of an intervention is what the dedup
 * of the guard compares, so the branch that decides has to be the one with
 * the highest seriousness.
 */
export function assessExploration(state, budget = DEFAULT_EXPLORATION_BUDGET) {
    if (budget.readBudget > 0 && state.readCount >= budget.readBudget) {
        return {
            kind: "read-budget",
            paths: [],
            message: `The exploration budget of ${budget.readBudget} reads is reached. ` +
                "Record the checkpoint before another broad exploration batch. " +
                "If the evidence is sufficient, implement the smallest justified change; otherwise name the missing evidence or the blocker. " +
                CHECKPOINT_REQUEST_TEXT,
            requiresCheckpoint: true,
            suggestsImplementation: true,
        };
    }
    if (budget.tokenWarning > 0 &&
        state.estimatedTokens >= budget.tokenWarning) {
        return {
            kind: "token-budget",
            paths: [],
            message: `The estimated exploration cost reached ${state.estimatedTokens} tokens. ` +
                "Record the checkpoint before another broad exploration batch. " +
                CHECKPOINT_REQUEST_TEXT,
            requiresCheckpoint: true,
            suggestsImplementation: true,
        };
    }
    if (budget.timeWarningMs > 0 && state.explorationTimeMs >= budget.timeWarningMs) {
        return {
            kind: "time-budget",
            paths: [],
            message: `The exploration ran for ${Math.round(state.explorationTimeMs / 1000)} seconds. ` +
                "Record the checkpoint before another broad exploration batch. " +
                CHECKPOINT_REQUEST_TEXT,
            requiresCheckpoint: true,
            suggestsImplementation: true,
        };
    }
    const repeated = repeatedPaths(state);
    if (repeated.length > 0) {
        const worst = state.files
            .filter((file) => file.repeatCount > 0)
            .sort((a, b) => b.repeatCount - a.repeatCount)[0];
        if (worst && worst.repeatCount >= budget.repeatWarning) {
            return {
                kind: "repeat-read",
                paths: repeated,
                message: `${worst.path} was read ${worst.repeatCount} times without a new question. ` +
                    "State the question that needs the reread, or use the recorded findings instead of reading it again. " +
                    CHECKPOINT_REQUEST_TEXT,
                requiresCheckpoint: true,
                suggestsImplementation: false,
            };
        }
    }
    if (budget.stallWarning > 0 &&
        readsSinceNarrowing(state) >= budget.stallWarning &&
        !hasSubstantiveProgress(state)) {
        return {
            kind: "stall",
            paths: [],
            message: `${state.readCount} reads happened without a recorded narrowing of the problem. ` +
                "State the findings, the questions that are still open, the next action and why more exploration is needed. " +
                CHECKPOINT_REQUEST_TEXT,
            requiresCheckpoint: true,
            suggestsImplementation: false,
        };
    }
    if (budget.readWarning > 0 && state.readCount >= budget.readWarning) {
        return {
            kind: "none",
            paths: [],
            message: `${state.readCount} reads so far. Record the checkpoint when the findings change. ` +
                CHECKPOINT_REQUEST_TEXT,
            requiresCheckpoint: false,
            suggestsImplementation: false,
        };
    }
    return {
        kind: "none",
        paths: [],
        message: "",
        requiresCheckpoint: false,
        suggestsImplementation: false,
    };
}
/**
 * True when the intervention is one that has to be shown to the agent.
 */
export function isVisibleIntervention(intervention) {
    return intervention.kind !== "none" || intervention.message.length > 0;
}
//# sourceMappingURL=budget.js.map
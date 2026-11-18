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
import { assessExploration, DEFAULT_EXPLORATION_BUDGET, classifyRepeat, interventionSeverity, isVisibleIntervention, } from "./budget.js";
import { applyCheckpoint, buildContinuationText, } from "./checkpoint.js";
import { observeToolCall, } from "./observation.js";
import { createState, ensureCoverage, ensureSearch, ExplorationStateStore, sanitizePath, sanitizeText, stateFileName, } from "./state.js";
import { explorationStatus, formatExplorationStatus } from "./status.js";
/**
 * The number of characters of a returned result per token.
 *
 * The estimate is deliberately rough: it says how big the reading was, not
 * what the model paid for it. The state marks it as approximate.
 */
const CHARS_PER_TOKEN = 4;
/**
 * The key of a state.
 *
 * The state carries its own identity, so the tracker can write the memory
 * of the guard back into the file of the request.
 */
function keyOfState(state) {
    return {
        workspace: state.workspace,
        sessionId: state.sessionId,
        generation: state.generation,
        phase: state.phase,
        todoId: state.todoId,
    };
}
/**
 * The tracker of the exploration of a request.
 */
export class ExplorationTracker {
    store;
    budget;
    now;
    /**
     * The states of the requests this tracker owns.
     *
     * The tracker keeps the state of a request in memory, so a hundred
     * reads of one request do not read the file a hundred times. The file
     * is the durable copy, and it is written on every observation.
     */
    cache = new Map();
    constructor(options = {}) {
        this.store = options.store ?? new ExplorationStateStore();
        this.budget = options.budget ?? DEFAULT_EXPLORATION_BUDGET;
        this.now = options.now ?? (() => Date.now());
    }
    /**
     * The state of a request.
     *
     * A request that was never seen has a fresh state. A request whose
     * state cannot be read is an error: it must not be mistaken for a
     * fresh request.
     */
    state(key) {
        const cached = this.cache.get(stateFileName(key));
        if (cached)
            return cached;
        const existing = this.store.read(key);
        const state = existing ?? createState(key, this.now());
        this.cache.set(stateFileName(key), state);
        return state;
    }
    /**
     * Observe a tool call and its result.
     *
     * A failed read observed nothing, and a tool the guard does not know
     * says nothing about the coverage of a file.
     */
    observe(key, call, end) {
        const state = this.state(key);
        const observation = observeToolCall(call, end);
        if (!observation || observation.failed) {
            const intervention = assessExploration(state, this.budget);
            return { state, intervention, shouldSpeak: false };
        }
        const next = this.applyObservation(state, observation);
        this.cache.set(stateFileName(key), next);
        this.store.write(next);
        const intervention = assessExploration(next, this.budget);
        const shouldSpeak = this.shouldSpeak(intervention, next);
        return { state: next, intervention, shouldSpeak };
    }
    /**
     * Apply one observation to the state.
     */
    applyObservation(state, observation) {
        const now = this.now();
        const next = {
            ...state,
            // Only a read of a file counts as a read: a search and a tool
            // the guard does not know read no file.
            readCount: state.readCount + (observation.countsAsRead ? 1 : 0),
            explorationTimeMs: state.explorationTimeMs + (observation.durationMs ?? 0),
            estimatedTokens: state.estimatedTokens +
                Math.ceil((observation.observedBytes ?? 0) / CHARS_PER_TOKEN),
            estimatedTokensApproximate: true,
            updatedAt: now,
        };
        if (observation.kind === "search") {
            const query = observation.query
                ? sanitizeText(observation.query)
                : undefined;
            if (query) {
                const scope = observation.scope
                    ? sanitizePath(observation.scope)
                    : undefined;
                const search = ensureSearch(next.searches, query, scope);
                search.count += 1;
                search.observedBytes =
                    (search.observedBytes ?? 0) + (observation.observedBytes ?? 0);
            }
            return next;
        }
        // A shell command that was not recognised says nothing about the
        // coverage of a file.
        if (observation.source === "unknown" || !observation.path) {
            return next;
        }
        const path = sanitizePath(observation.path);
        if (!path)
            return next;
        const files = [...next.files];
        const coverage = ensureCoverage(files, path);
        coverage.readCount += 1;
        coverage.searchOnly = false;
        if (observation.observedBytes !== undefined) {
            coverage.observedBytes =
                (coverage.observedBytes ?? 0) + observation.observedBytes;
        }
        if (observation.range) {
            const kind = classifyRepeat(coverage, observation.range);
            if (kind === "repeat") {
                coverage.repeatCount += 1;
                next.repeatCount = next.repeatCount + 1;
            }
            else if (kind === "new") {
                coverage.ranges.push(observation.range);
            }
        }
        next.files = files;
        return next;
    }
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
    shouldSpeak(intervention, state) {
        if (!isVisibleIntervention(intervention))
            return false;
        const severity = interventionSeverity(intervention.kind);
        // The memory of the guard belongs to the request, not to the
        // tracker: a warning that was delivered in one request must not
        // silence the first warning of the next one.
        const spokenRevision = state.spokenRevision ?? -1;
        const spokenSeverity = state.spokenSeverity ?? 0;
        if (spokenRevision === state.checkpointRevision &&
            severity <= spokenSeverity) {
            return false;
        }
        return true;
    }
    /**
     * Mark the guard as having spoken.
     *
     * The guard speaks again when the checkpoint of the agent changes, or
     * when the seriousness of the intervention grows. The seriousness is
     * remembered as it was, not as the largest one ever seen: a request
     * that answered a budget warning with a checkpoint may run into a soft
     * warning again, and that warning has to be heard too.
     */
    markSpoken(state, severity) {
        // The memory of the guard is part of the state of the request: it
        // is durable, and it does not leak into the next request.
        const next = {
            ...state,
            spokenRevision: state.checkpointRevision,
            spokenSeverity: severity,
            updatedAt: this.now(),
        };
        this.cache.set(stateFileName(keyOfState(next)), next);
        this.store.write(next);
    }
    /**
     * The checkpoint of the agent, merged into the state.
     */
    recordCheckpoint(key, input) {
        const state = this.state(key);
        const next = applyCheckpoint(state, input, this.now());
        this.cache.set(stateFileName(key), next);
        this.store.write(next);
        return next;
    }
    /**
     * The text that the agent receives after a compaction.
     */
    continuationText(key) {
        return buildContinuationText(this.state(key));
    }
    /**
     * The status of the exploration.
     */
    status(key) {
        const state = this.state(key);
        const intervention = assessExploration(state, this.budget);
        return formatExplorationStatus(explorationStatus(state, intervention));
    }
    /**
     * Persist the state of a request.
     */
    save(key, state) {
        this.cache.set(stateFileName(key), state);
        return this.store.write(state);
    }
    /**
     * The phase of a request.
     */
    static phaseOf(value) {
        switch (value) {
            case "implementation":
            case "review":
            case "review_fixes":
            case "test":
                return value;
            default:
                return "other";
        }
    }
}
//# sourceMappingURL=tracker.js.map
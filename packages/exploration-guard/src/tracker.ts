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

import {
	assessExploration,
	DEFAULT_EXPLORATION_BUDGET,
	classifyRepeat,
	type Intervention,
	isVisibleIntervention,
} from "./budget.js";
import {
	applyCheckpoint,
	buildContinuationText,
	type CheckpointInput,
} from "./checkpoint.js";
import {
	observeToolCall,
	type ToolCallEnd,
	type ToolCallInput,
} from "./observation.js";
import {
	createState,
	ensureCoverage,
	ensureSearch,
	ExplorationStateStore,
	sanitizePath,
	sanitizeText,
	stateFileName,
} from "./state.js";
import { explorationStatus, formatExplorationStatus } from "./status.js";
import type {
	ExplorationBudget,
	ExplorationKey,
	ExplorationPhase,
	ExplorationState,
} from "./types.js";

/**
 * The number of characters of a returned result per token.
 *
 * The estimate is deliberately rough: it says how big the reading was, not
 * what the model paid for it. The state marks it as approximate.
 */
const CHARS_PER_TOKEN = 4;

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
export class ExplorationTracker {
	private readonly store: ExplorationStateStore;
	private readonly budget: ExplorationBudget;
	private readonly now: () => number;
	/** The revision the guard last spoke at. */
	private spokenRevision = -1;
	/**
	 * The states of the requests this tracker owns.
	 *
	 * The tracker keeps the state of a request in memory, so a hundred
	 * reads of one request do not read the file a hundred times. The file
	 * is the durable copy, and it is written on every observation.
	 */
	private readonly cache = new Map<string, ExplorationState>();

	constructor(options: ExplorationTrackerOptions = {}) {
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
	state(key: ExplorationKey): ExplorationState {
		const cached = this.cache.get(stateFileName(key));
		if (cached) return cached;
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
	observe(
		key: ExplorationKey,
		call: ToolCallInput,
		end?: ToolCallEnd,
	): ObservationResult {
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
	private applyObservation(
		state: ExplorationState,
		observation: ReturnType<typeof observeToolCall> & object,
	): ExplorationState {
		const now = this.now();
		const next: ExplorationState = {
			...state,
			readCount: state.readCount + 1,
			explorationTimeMs:
				state.explorationTimeMs + (observation.durationMs ?? 0),
			estimatedTokens:
				state.estimatedTokens +
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
		if (!path) return next;

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
			} else if (kind === "new") {
				coverage.ranges.push(observation.range);
			}
		}
		next.files = files;
		return next;
	}

	/**
	 * True when the guard has to speak.
	 *
	 * The guard speaks once per checkpoint revision, so a batch of parallel
	 * reads produces one reminder and not one per file.
	 */
	private shouldSpeak(
		intervention: Intervention,
		state: ExplorationState,
	): boolean {
		if (!isVisibleIntervention(intervention)) return false;
		if (this.spokenRevision === state.checkpointRevision) return false;
		return true;
	}

	/**
	 * Mark the guard as having spoken.
	 *
	 * The guard speaks again when the checkpoint of the agent changes, so a
	 * new checkpoint opens a new intervention.
	 */
	markSpoken(state: ExplorationState): void {
		this.spokenRevision = state.checkpointRevision;
	}

	/**
	 * The checkpoint of the agent, merged into the state.
	 */
	recordCheckpoint(
		key: ExplorationKey,
		input: CheckpointInput,
	): ExplorationState {
		const state = this.state(key);
		const next = applyCheckpoint(state, input, this.now());
		this.cache.set(stateFileName(key), next);
		this.store.write(next);
		return next;
	}

	/**
	 * The text that the agent receives after a compaction.
	 */
	continuationText(key: ExplorationKey): string {
		return buildContinuationText(this.state(key));
	}

	/**
	 * The status of the exploration.
	 */
	status(key: ExplorationKey): string {
		const state = this.state(key);
		const intervention = assessExploration(state, this.budget);
		return formatExplorationStatus(explorationStatus(state, intervention));
	}

	/**
	 * Persist the state of a request.
	 */
	save(key: ExplorationKey, state: ExplorationState): ExplorationState {
		this.cache.set(stateFileName(key), state);
		return this.store.write(state);
	}

	/**
	 * The phase of a request.
	 */
	static phaseOf(value: string): ExplorationPhase {
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

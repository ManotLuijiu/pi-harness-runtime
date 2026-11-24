/**
 * The runtime of the exploration guard.
 *
 * The runtime observes the tools of the agent, keeps the state of the
 * request, and hands the decision of the guard to the caller.
 *
 * The runtime never sends anything and never authorises anything. It
 * returns a pending intervention at a safe boundary, and the caller decides
 * what to do with it. The runtime never touches a provider countdown, never
 * answers a question of the human and never starts a second continuation
 * owner.
 */

import type {
	CheckpointInput,
	ExplorationKey,
	ExplorationPhase,
	ExplorationState,
	Intervention,
	ToolCallEnd,
	ToolCallInput,
} from "../packages/exploration-guard/dist/index.js";
import {
	buildContinuationText,
	describeUnreadableCheckpoint,
	ExplorationTracker,
	interventionSeverity,
	toCompactCheckpoint,
} from "../packages/exploration-guard/dist/index.js";

/**
 * The identity of the request that is running.
 *
 * Every part of it is read when it is needed, so a change of the session or
 * of the generation moves the exploration to another state.
 */
export interface ExplorationIdentity {
	/** The canonical workspace of the request. */
	workspace: () => string;
	/** The session of the request. */
	sessionId: () => string;
	/** The generation of the request. */
	generation: () => string;
	/** The phase of the request. */
	phase: () => ExplorationPhase;
	/** The todo of the request, when the request owns one. */
	todoId?: () => number | undefined;
}

/**
 * The options of the runtime.
 */
export interface ExplorationRuntimeOptions {
	/** The identity of the request. */
	identity: ExplorationIdentity;
	/** The tracker of the exploration. */
	tracker?: ExplorationTracker;
	/** The clock, so a test can pin the time. */
	now?: () => number;
}

/**
 * A pending intervention of the guard.
 *
 * It is pending until a safe boundary: the runtime speaks once, and the
 * caller consumes it when the agent is between turns.
 */
export interface PendingIntervention {
	/** The key of the request. */
	key: ExplorationKey;
	/** The text the agent receives. */
	message: string;
	/** True when the guard asks for a checkpoint. */
	requiresCheckpoint: boolean;
	/** The kind of the intervention. */
	kind: Intervention["kind"];
	/**
	 * How serious the intervention is.
	 *
	 * The seriousness is part of the identity of the intervention: a
	 * warning that was delivered does not silence a budget that is reached
	 * later in the same checkpoint.
	 */
	severity: number;
	/** The state of the request when the intervention was raised. */
	state: ExplorationState;
}

/**
 * The number of times the guard speaks in one request.
 *
 * The guard asks, it does not nag: a request that ignored three warnings
 * does not get a fourth one. The agent decides, and a decision that is not
 * taken is not the business of the guard.
 */
const MAX_SPEECHES_PER_REQUEST = 3;

/**
 * The runtime of the exploration guard.
 */
export class ExplorationGuardRuntime {
	private readonly identity: ExplorationIdentity;
	private readonly tracker: ExplorationTracker;
	private readonly now: () => number;
	/** The calls that are running, by their id. */
	private readonly running = new Map<string, ToolCallInput>();
	/** The intervention that was not consumed yet. */
	private pending: PendingIntervention | null = null;
	/** The generation the pending intervention belongs to. */
	private pendingGeneration = "";
	/** True when the request was completed or cancelled. */
	private inactive = false;
	/** How often the guard spoke in this request. */
	private speechCount = 0;

	constructor(options: ExplorationRuntimeOptions) {
		this.identity = options.identity;
		this.tracker = options.tracker ?? new ExplorationTracker();
		this.now = options.now ?? (() => Date.now());
	}

	/** The key of the request that is running. */
	key(): ExplorationKey {
		return {
			workspace: this.identity.workspace(),
			sessionId: this.identity.sessionId(),
			generation: this.identity.generation(),
			phase: this.identity.phase(),
			todoId: this.identity.todoId?.(),
		};
	}

	/**
	 * A tool call begins.
	 *
	 * The call is remembered, so its result can be paired with it. Nothing
	 * is observed yet: a call that fails read nothing.
	 */
	toolCall(toolCallId: string, call: ToolCallInput): void {
		this.running.set(toolCallId, call);
	}

	/**
	 * A tool call ended.
	 *
	 * The observation is made here, because only the result says whether
	 * the tool read anything.
	 */
	toolCallEnd(
		toolCallId: string,
		end: ToolCallEnd,
	): PendingIntervention | null {
		const call = this.running.get(toolCallId);
		this.running.delete(toolCallId);
		if (!call) return null;
		if (this.inactive) return null;

		let result: { shouldSpeak: boolean; intervention: Intervention; state: ExplorationState };
		try {
			// Context-mode execution may return source-derived output, but its
			// code is not evidence that a particular file/range was read. Count
			// the returned bytes without inventing coverage for those tools.
			const observationCall = /(?:^|__)ctx_(?:batch_execute|execute(?:_file)?|search)$/.test(call.toolName)
				? { toolName: "bash", input: { command: "" } }
				: call;
			result = this.tracker.observe(this.key(), observationCall, end);
		} catch {
			// The state could not be read or written: the guard stays quiet
			// instead of guessing what was read.
			return null;
		}
		if (!result.shouldSpeak) return null;

		const severity = interventionSeverity(result.intervention.kind);
		if (!this.maySpeak(severity, result.state)) return null;

		// The intervention is queued, not delivered. The budget of the
		// speech and the deduplication of the revision are only spent when
		// the delivery worked: a message that never reached the agent has
		// not been spoken yet, and it may be spoken again.
		const key = this.key();
		this.pending = {
			key,
			message: result.intervention.message,
			requiresCheckpoint: result.intervention.requiresCheckpoint,
			kind: result.intervention.kind,
			severity,
			state: result.state,
		};
		this.pendingGeneration = key.generation;
		return this.pending;
	}

	/**
	 * The intervention reached the agent.
	 *
	 * The caller reports a delivery that worked. Only then does the guard
	 * count the speech, remember the revision and remember the
	 * seriousness: a delivery that the guarded path refused has not spoken,
	 * and the next observation may speak again.
	 */
	delivered(pending: PendingIntervention): void {
		if (pending.key.generation !== this.pendingGeneration) {
			// The intervention belongs to a request that is gone.
			return;
		}
		this.tracker.markSpoken(pending.state, pending.severity);
		this.speechCount += 1;
	}

	/**
	 * True when the guard may speak.
	 *
	 * The guard speaks once per checkpoint revision, and again when the
	 * seriousness of the intervention grew. It speaks at most three times
	 * in one request: a request that ignored the warnings is not nagged.
	 *
	 * The memory of the guard is the state of the request: it is durable,
	 * it belongs to the request, and it is only written when the
	 * intervention really reached the agent. A delivery that was refused
	 * spends nothing, so the intervention may be spoken again.
	 */
	private maySpeak(severity: number, state: ExplorationState): boolean {
		if (this.speechCount >= MAX_SPEECHES_PER_REQUEST) return false;
		const spokenRevision = state.spokenRevision ?? -1;
		const spokenSeverity = state.spokenSeverity ?? 0;
		const revisionChanged = spokenRevision !== state.checkpointRevision;
		const escalated = severity > spokenSeverity;
		return revisionChanged || escalated;
	}

	/**
	 * The intervention that was not consumed yet.
	 *
	 * The intervention is inert when the request changed: a new request of
	 * the human does not inherit the warning of the old one.
	 */
	takePending(): PendingIntervention | null {
		const pending = this.pending;
		if (!pending) return null;
		if (pending.key.generation !== this.pendingGeneration) {
			this.pending = null;
			return null;
		}
		if (pending.key.generation !== this.identity.generation()) {
			this.pending = null;
			return null;
		}
		this.pending = null;
		return pending;
	}

	/**
	 * The request is finished, cancelled or answered.
	 *
	 * The pending actions of the guard become inert: a completed request
	 * must not be continued by the guard.
	 */
	deactivate(): void {
		this.inactive = true;
		this.pending = null;
		this.running.clear();
	}

	/**
	 * A new request of the human begins.
	 *
	 * The guard is active again, and the state of the new request is its
	 * own: the counters of the old request do not carry over.
	 */
	activate(): void {
		this.inactive = false;
		this.pending = null;
		this.speechCount = 0;
	}

	/**
	 * The checkpoint that survives a compaction.
	 *
	 * The checkpoint is saved before the compaction, so the summary of the
	 * context and the record of the exploration are two separate things.
	 */
	saveCheckpoint(): void {
		if (this.inactive) return;
		try {
			const state = this.tracker.state(this.key());
			this.tracker.save(this.key(), {
				...state,
				updatedAt: this.now(),
			});
		} catch {
			// The checkpoint could not be saved: the compaction continues and
			// the uncertainty is reported afterwards.
		}
	}

	/**
	 * The text that the agent receives after a compaction.
	 *
	 * The text names the checkpoint of the request. When the checkpoint
	 * cannot be read, the text says so: an unknown coverage is never a
	 * fresh budget and never the knowledge of the whole repository.
	 */
	continuationAfterCompaction(): string {
		try {
			const state = this.tracker.state(this.key());
			return buildContinuationText(state);
		} catch (error) {
			return describeUnreadableCheckpoint((error as Error).message);
		}
	}

	/**
	 * The compact checkpoint of the request, for a durable copy.
	 */
	compactCheckpoint(): ReturnType<typeof toCompactCheckpoint> | null {
		if (this.inactive) return null;
		try {
			return toCompactCheckpoint(this.tracker.state(this.key()), this.now());
		} catch {
			return null;
		}
	}

	/**
	 * The status of the exploration.
	 */
	status(): string {
		try {
			return this.tracker.status(this.key());
		} catch {
			return "investigating | unknown";
		}
	}

	/**
	 * Record the checkpoint that the agent reports.
	 *
	 * The findings, the questions, the next action and the hashes of the
	 * files that were read are written to the state of the request, so a
	 * compaction does not make the agent find them again.
	 *
	 * A checkpoint of a finished request is ignored: the request is over
	 * and its record is closed.
	 */
	recordCheckpoint(input: CheckpointInput): boolean {
		if (this.inactive) return false;
		try {
			// A partial checkpoint must not erase earlier findings merely
			// because the agent only supplied the next chunk's action. An
			// explicit empty array still clears a resolved set of questions.
			const previous = this.tracker.state(this.key()).checkpoint;
			this.tracker.recordCheckpoint(this.key(), {
				...input,
				findings: input.findings ?? previous.findings,
				hypotheses: input.hypotheses ?? previous.hypotheses,
				openQuestions: input.openQuestions ?? previous.openQuestions,
				nextAction: input.nextAction ?? previous.nextAction,
			});
			return true;
		} catch {
			// The checkpoint could not be written: the agent continues
			// without it, and the record of the request stays as it was.
			return false;
		}
	}
}

/**
 * The lifecycle of a wait for a human answer.
 *
 * The harness asks a human a question and waits. When the wait is over the
 * question is decided once - by the human, by Jev, or not at all. This
 * module owns that lifecycle:
 *
 *     waiting -> evaluating -> decided | human_required | evaluation_error
 *
 * It owns the request the wait belongs to, the session it was asked in, the
 * moment the question was asked, the cancellation and the countdown. The
 * countdown and the decision are measured from that one timestamp, so the
 * time that reaches the evaluation is the same time the countdown shows.
 *
 * The rules that matter:
 *
 * - One evaluation per request. A decision to wait ends the automatic
 *   attempt: the work pauses and a human is needed. Another attempt would
 *   be a second evaluation of the same question, and it is what turned a
 *   five minute wait into a repeating countdown.
 * - A provider failure is an evaluation error, not a decision. It never
 *   becomes "Jev decided to wait": the two mean different things to the
 *   reader of the log and to the work.
 * - Every late result is discarded. An evaluation that finishes after the
 *   question was answered, replaced or the session changed must not change
 *   anything: the state belongs to the request that is still waiting.
 */

import type { DecisionOutcome, DecisionScope } from "./auto-continue.js";

/**
 * The state of a wait.
 *
 * - `idle`: nothing is waiting.
 * - `waiting`: a question waits for a human answer.
 * - `evaluating`: the decision of the question is running.
 * - `decided`: Jev decided; the outcome says what the work does.
 * - `human_required`: the decision needs a human; the work is blocked.
 * - `evaluation_error`: the evaluation failed; no decision was made.
 */
export type WaitLifecycleState =
	| "idle"
	| "waiting"
	| "evaluating"
	| "decided"
	| "human_required"
	| "evaluation_error";

/** The question a wait is about. */
export interface WaitRequest {
	/** The canonical request ID of the question. */
	requestId: string;
	/** The session the question was asked in. */
	sessionId: string;
	/** The kind of the question ("approval", "choice", ...). */
	kind?: string;
	/** The typed ask of the question. */
	askType?: string;
	/** The text of the question. */
	text?: string;
	/** The message the question was detected in. */
	contextText?: string;
	/** The concrete alternatives of a choice question. */
	alternatives?: string[];
	/**
	 * What the question is about.
	 *
	 * The relevance decides whether the wait may reach the judge at all: an
	 * offer of work that was not asked for is never decided by silence.
	 */
	relevance?: string;
}

/** The result of one evaluation. */
export interface WaitEvaluation {
	/** The outcome of the decision. */
	outcome: DecisionOutcome;
	/** The option the evaluation selected for a choice question. */
	selectedOption?: string;
	/** The scope the evaluation selected. */
	scope?: DecisionScope;
	/** The reasoning of the decision. */
	reasoning: string;
	/** The policy rule that changed the outcome, when one did. */
	policyApplied?: string;
	/** The risk level the evaluation gave the action. */
	riskLevel?: string;
	/**
	 * The evaluation failed.
	 *
	 * A failed evaluation is not a decision: it says nothing about the
	 * action, so it must never be recorded as "Jev decided to wait".
	 */
	error?: { kind: "provider" | "unknown"; message: string };
	/**
	 * The request the evaluation was made for.
	 *
	 * The controller stamps it: a decision belongs to the request it was
	 * evaluated for, and to no other request. A result that arrives after
	 * its request was answered, replaced or cancelled must never be
	 * applied to the request that happens to be current when the result is
	 * applied.
	 */
	requestId?: string;
	/**
	 * The session the evaluation was made in.
	 *
	 * The controller stamps it for the same reason: a decision of one
	 * session is not a decision of another.
	 */
	sessionId?: string;
}

/**
 * The countdown of the wait.
 *
 * The controller owns the countdown; the implementation owns the display.
 * The deadline is derived from the moment the question was asked, so the
 * countdown and the decision can never drift apart.
 */
export interface WaitCountdown {
	/** Start the countdown of a request (or replace the running one). */
	start(requestId: string, startedAt: number): void;
	/** Release the countdown. */
	stop(): void;
	/** Is the countdown running? */
	readonly active: boolean;
}

/** What the controller reports about a state change. */
export interface WaitStateDetail {
	/** The request the state belongs to. */
	requestId: string | null;
	/** The state that was reached. */
	state: WaitLifecycleState;
	/** The decision, when the state was reached by one. */
	evaluation?: WaitEvaluation;
	/** The reason of the state, in words. */
	reason: string;
}

/** The dependencies of the controller. */
export interface WaitLifecycleDeps {
	/** The clock. The tests drive it. */
	now?: () => number;
	/** The countdown of the wait. */
	countdown?: WaitCountdown;
	/** The minutes the question waits for a human answer. */
	waitMinutes: number;
	/** The session the runtime is in. The tests drive it. */
	currentSessionId?: () => string | null;
	/** The evaluation of one request. */
	evaluate: (
		request: WaitRequest,
		waitedMs: number,
	) => Promise<WaitEvaluation>;
	/** The state of the wait changed. */
	onState?: (state: WaitLifecycleState, detail: WaitStateDetail) => void;
	/**
	 * Is the wait still eligible for an automatic decision?
	 *
	 * The owner of the wait answers: it knows the state of the work and the
	 * relevance of the question. The controller asks before it evaluates,
	 * so an obsolete wait never reaches the judge.
	 */
	eligibility?: () =>
		| Promise<{ eligible: boolean; reason: string }>
		| { eligible: boolean; reason: string };
	/** A failure of the controller itself. */
	onError?: (error: unknown) => void;
}

/** Why an evaluation was not applied. */
export type WaitDiscardReason =
	| "no-request"
	| "not-waiting"
	| "not-due"
	| "not-eligible"
	| "stale"
	| "other-session";

/** What the controller did with an evaluation. */
export interface WaitLifecycleResult {
	/** Did the evaluation change the state? */
	applied: boolean;
	/** The state of the wait afterwards. */
	state: WaitLifecycleState;
	/** The decision, when there was one. */
	evaluation?: WaitEvaluation;
	/** The reason, in words. */
	reason: string;
	/** Why the evaluation was not applied, when it was not. */
	discardReason?: WaitDiscardReason;
}

/** The message of a failure, in one line. */
function messageOf(error: unknown): string {
	const text = error instanceof Error ? error.message : String(error);
	return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * The controller of a wait for a human answer.
 *
 * The controller owns the lifecycle of one question at a time: a new
 * question replaces the old one, an answer ends the wait, and a late result
 * of an older request is discarded.
 */
export class WaitLifecycleController {
	private readonly deps: WaitLifecycleDeps;
	private readonly now: () => number;
	private state: WaitLifecycleState = "idle";
	private request: WaitRequest | null = null;
	private questionAt = 0;
	/**
	 * Bumped on every change of the request.
	 *
	 * A result of an older generation belongs to a request that is gone: it
	 * is discarded instead of changing the state of the new one.
	 */
	private generation = 0;

	constructor(deps: WaitLifecycleDeps) {
		this.deps = deps;
		this.now = deps.now ?? (() => Date.now());
	}

	/** The state of the wait. */
	get currentState(): WaitLifecycleState {
		return this.state;
	}

	/** The request the wait belongs to. */
	get currentRequestId(): string | null {
		return this.request?.requestId ?? null;
	}

	/** The session the waiting question was asked in. */
	get currentSessionId(): string | null {
		return this.request?.sessionId ?? null;
	}

	/** The moment the question was asked (in milliseconds). */
	get questionAskedAt(): number | null {
		return this.request ? this.questionAt : null;
	}

	/** Is the wait about this request? */
	owns(requestId: string | undefined | null): boolean {
		return !!requestId && this.request?.requestId === requestId;
	}

	/**
	 * Does this evaluation belong to the request that waits?
	 *
	 * The evaluation carries the identity of the request it was made for.
	 * A result of a request that was answered, replaced or cancelled is
	 * stale: it must not be applied to the request that is current now,
	 * because that request is a different question with its own decision.
	 *
	 * An evaluation without an identity belongs to nothing and is stale by
	 * default: the answer to "may I apply this?" is then "no".
	 */
	ownsEvaluation(evaluation: WaitEvaluation): boolean {
		if (!evaluation.requestId) return false;
		if (!this.owns(evaluation.requestId)) return false;
		return this.currentSessionId === evaluation.sessionId;
	}

	/** The milliseconds since the question was asked. */
	elapsedMs(): number {
		if (!this.request) return 0;
		return Math.max(0, this.now() - this.questionAt);
	}

	/**
	 * The minutes since the question was asked.
	 *
	 * This is the one elapsed time: the countdown, the evaluation and the
	 * fallback of the judge all measure the same wait.
	 */
	waitedMinutes(): number {
		return this.elapsedMs() / 60_000;
	}

	/** Is the deadline of the decision reached? */
	isDue(): boolean {
		return this.elapsedMs() >= this.deps.waitMinutes * 60_000;
	}

	/**
	 * A question was asked: the wait starts.
	 *
	 * A question that replaces another one invalidates the evaluation of
	 * the old one: the generation is bumped, so a late result of the old
	 * request cannot change the state of the new one.
	 */
	begin(request: WaitRequest): void {
		this.generation += 1;
		this.request = request;
		this.questionAt = this.now();
		this.setState("waiting", "the question waits for an answer");
		try {
			this.deps.countdown?.start(request.requestId, this.questionAt);
		} catch (error) {
			this.report(error);
		}
	}

	/**
	 * The question was answered by a human: the wait is over.
	 *
	 * The evaluation of that request - if it is still running - is
	 * invalidated: its result belongs to a question that has an answer.
	 */
	answer(requestId: string): void {
		if (!this.owns(requestId)) return;
		this.end("idle", "the question was answered");
	}

	/**
	 * The session changed: the wait belongs to a session that is gone.
	 */
	invalidate(reason: string): void {
		if (!this.request && this.state === "idle") return;
		this.end("idle", reason);
	}

	/** The wait is over for any reason. */
	cancel(): void {
		this.end("idle", "the wait was cancelled");
	}

	/**
	 * The deadline is reached: evaluate the current request once.
	 *
	 * The evaluation runs only when the wait is still waiting, the deadline
	 * is reached and the session is the one the question was asked in. A
	 * second call - the countdown and the fallback poll can both arrive -
	 * does nothing: the state is no longer "waiting".
	 */
	async evaluateDue(): Promise<WaitLifecycleResult> {
		const request = this.request;
		if (!request) {
			return {
				applied: false,
				state: this.state,
				reason: "no question is waiting",
				discardReason: "no-request",
			};
		}
		if (this.state !== "waiting") {
			return {
				applied: false,
				state: this.state,
				reason: `the wait is ${this.state}`,
				discardReason: "not-waiting",
			};
		}
		if (!this.isDue()) {
			return {
				applied: false,
				state: this.state,
				reason: "the question has not waited long enough",
				discardReason: "not-due",
			};
		}
		const session = this.deps.currentSessionId?.() ?? request.sessionId;
		if (session !== request.sessionId) {
			return {
				applied: false,
				state: this.state,
				reason: "the question belongs to another session",
				discardReason: "other-session",
			};
		}

		// The identity of the request is captured before anything can
		// await: a result of an older generation belongs to a request that
		// is gone, and it must be discarded even when the request was
		// answered while the runtime was still preparing the evaluation.
		const generation = this.generation;

		// The wait is checked once more before the judge is asked: the work
		// of the question can be done while it waited, and an obsolete wait
		// must not decide anything.
		const eligibility = await this.deps.eligibility?.();

		// The identity of the request is checked before anything is ended:
		// the question may have been answered or replaced while the
		// eligibility was read, and a stale check must never clear the wait
		// of a newer question.
		if (generation !== this.generation || this.request?.requestId !== request.requestId) {
			return {
				applied: false,
				state: this.state,
				reason: "the evaluation is stale",
				discardReason: "stale",
			};
		}

		if (eligibility && !eligibility.eligible) {
			// The wait ends here, so the timer, the state and the in-flight
			// evaluation of that request end with it.
			this.end("idle", eligibility.reason);
			return {
				applied: false,
				state: "idle",
				reason: eligibility.reason,
				discardReason: "not-eligible",
			};
		}

		this.setState("evaluating", "the decision of the question is running");
		let evaluation: WaitEvaluation;
		try {
			evaluation = await this.deps.evaluate(request, this.elapsedMs());
		} catch (error) {
			// A failing evaluation is an error, not a decision.
			evaluation = {
				outcome: "wait",
				reasoning: "",
				error: { kind: "provider", message: messageOf(error) },
			};
		}

		// The identity of the request is captured here and stamped on the
		// result. The decision belongs to the request it was evaluated for:
		// it cannot be applied to a request that only happens to be current
		// when the result arrives.
		evaluation = {
			...evaluation,
			requestId: request.requestId,
			sessionId: request.sessionId,
		};

		// Every late result is discarded: the question was answered, replaced
		// or the session changed while the evaluation ran.
		if (generation !== this.generation || this.request?.requestId !== request.requestId) {
			return {
				applied: false,
				state: this.state,
				reason: "the evaluation is stale",
				discardReason: "stale",
			};
		}
		const currentSession = this.deps.currentSessionId?.() ?? request.sessionId;
		if (currentSession !== request.sessionId) {
			return {
				applied: false,
				state: this.state,
				reason: "the question belongs to another session",
				discardReason: "other-session",
			};
		}

		if (evaluation.error) {
			// The provider failed: the work is not continued and nothing is
			// decided. The question stays open for the human.
			this.setState(
				"evaluation_error",
				`the evaluation failed: ${evaluation.error.message}`,
				evaluation,
			);
			return {
				applied: true,
				state: "evaluation_error",
				evaluation,
				reason: evaluation.error.message,
			};
		}

		if (evaluation.outcome === "wait") {
			// A decision to wait is a blocked state: the work pauses and a
			// human is needed. The wait does not arm another attempt.
			this.setState(
				"human_required",
				evaluation.reasoning || "the decision asks for a human",
				evaluation,
			);
			return {
				applied: true,
				state: "human_required",
				evaluation,
				reason: evaluation.reasoning,
			};
		}

		this.setState(
			"decided",
			evaluation.reasoning || `the decision is ${evaluation.outcome}`,
			evaluation,
		);
		return {
			applied: true,
			state: "decided",
			evaluation,
			reason: evaluation.reasoning,
		};
	}

	/** End the wait: the request is gone and the countdown is released. */
	private end(state: WaitLifecycleState, reason: string): void {
		this.generation += 1;
		this.request = null;
		this.setState(state, reason);
		try {
			this.deps.countdown?.stop();
		} catch (error) {
			this.report(error);
		}
	}

	/** Report a state change. */
	private setState(
		state: WaitLifecycleState,
		reason: string,
		evaluation?: WaitEvaluation,
	): void {
		this.state = state;
		try {
			this.deps.onState?.(state, {
				requestId: this.request?.requestId ?? null,
				state,
				evaluation,
				reason,
			});
		} catch (error) {
			this.report(error);
		}
	}

	/** Report a failure without letting the report become a new failure. */
	private report(error: unknown): void {
		try {
			this.deps.onError?.(error);
		} catch {
			// The report of a failure must not become a new failure.
		}
	}
}

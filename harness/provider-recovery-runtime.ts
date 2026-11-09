/**
 * The runtime of the automatic resumes after a provider failure.
 *
 * The runtime owns the sequence of a failure:
 *
 * ```text
 * failure -> candidate -> (the run settles) -> attempt -> dispatch
 * ```
 *
 * Two boundaries matter, and both were missing before.
 *
 * **The settled boundary.** Pi retries a failed turn internally, and it
 * emits the events of the failed attempt before it decides to retry. A
 * recovery that starts at the message of the failed attempt is therefore a
 * competing continuation: while the internal retries run, the harness
 * injects its own resume. The runtime keeps the failure as a candidate and
 * starts the countdown when the run settles, which is the moment the
 * internal retries are over.
 *
 * **The ownership of the dispatch.** The injected message is the literal
 * `resume`, and that message clears an explicit pause of the user. A timer
 * that does not look at the state of the session therefore overrides the
 * decision of the user. Before every dispatch the runtime checks that the
 * session is the same, that the user did not pause, and that no question
 * waits for an answer.
 *
 * The runtime never owns the execution: it hands the resume to the
 * dispatcher, which is the existing executor of the harness.
 */
import type { ProviderFailure } from "./provider-failure.ts";
import type { PiRetryOutcome } from "./pi-retry-policy.ts";
import type { PendingAction, PendingActionRegistry } from "./pending-actions.ts";
import type {
	ProviderRecoveryController,
	RecoveryResetEvidence,
} from "./provider-recovery.ts";

/**
 * The state of the session, read when a resume would run.
 */
export interface ProviderRecoverySessionState {
	/** The session that is current now. */
	sessionId: string;
	/** The user paused the work explicitly. */
	explicitlyPaused: boolean;
	/** A question waits for the answer of the user. */
	questionPending: boolean;
	/**
	 * The session is busy: a request of the user is running.
	 *
	 * A resume that queues itself while a request runs lands on top of
	 * that request, and the work continues twice. The queued messages do
	 * not show this: a message that Pi already picked up is not queued
	 * anymore, so the fact that the session is busy is its own fact.
	 */
	sessionBusy: boolean;
}

/**
 * The decision about a dispatch.
 */
export type ProviderRecoveryDecision =
	| { allowed: true }
	| { allowed: false; reason: string };

/**
 * Whether a scheduled resume may still be dispatched.
 *
 * The resume is the literal `resume` message, and that message clears an
 * explicit pause of the user. A resume that ignores a pause overrides the
 * decision of the user, so the pause stops it. A changed session stops it
 * too: a resume of the previous session belongs to nobody.
 */
export function mayDispatchResume(state: {
	/** The session the resume was scheduled in. */
	scheduledSessionId: string;
	/** The state of the session now. */
	current: ProviderRecoverySessionState;
}): ProviderRecoveryDecision {
	if (state.scheduledSessionId !== state.current.sessionId) {
		return { allowed: false, reason: "the session changed" };
	}
	if (state.current.explicitlyPaused) {
		return { allowed: false, reason: "the user paused the work" };
	}
	if (state.current.questionPending) {
		return { allowed: false, reason: "a question waits for the user" };
	}
	if (state.current.sessionBusy) {
		return { allowed: false, reason: "the session is busy" };
	}
	return { allowed: true };
}

/**
 * A failure that waits for the settled boundary.
 */
export interface ProviderFailureCandidate {
	/** The classified failure. */
	failure: ProviderFailure;
	/** The identity of the failed turn. */
	failureKey: string;
	/** The provider that rejected the request. */
	provider: string;
	/**
	 * Whether the overload executor may resume this failure.
	 *
	 * The overload has its own executor, and it never joins the cycle: one
	 * failure has one executor.
	 */
	overloadEligible: boolean;
	/**
	 * Whether the bounded recovery cycle may resume this failure.
	 *
	 * The classification decides: a rate limit and an exhausted plan join
	 * the cycle, an overload keeps its own executor, and a credential
	 * failure joins neither.
	 */
	boundedEligible: boolean;
	/**
	 * What the attempts of the run say about the retry of Pi.
	 *
	 * A failure that Pi retries has a retry delay, and the user can cancel
	 * that delay. A failure that Pi does not retry has no delay, so no
	 * cancellation can be read into it.
	 *
	 * The verdict comes from the policy of the retry
	 * (`harness/pi-retry-policy.ts`): `cancelled` means that Pi stopped
	 * before its budget was spent, which only a cancellation of the delay
	 * does. The other two verdicts mean that the harness may recover.
	 */
	piRetryOutcome?: PiRetryOutcome;
}

/**
 * The options of the runtime.
 */
export interface ProviderRecoveryRuntimeOptions {
	/** The controller of the cycle. It decides the deadlines. */
	controller: ProviderRecoveryController;
	/** The registry of the pending actions. */
	actions: PendingActionRegistry;
	/** The identity of the pending action of an attempt of the cycle. */
	recoveryActionId: string;
	/** The identity of the pending action of a blocked provider. */
	blockedActionId: string;
	/** The identity of the pending action of the overload resume. */
	overloadActionId: string;
	/** The state of the session, read when a resume would run. */
	context: () => ProviderRecoverySessionState;
	/** The dispatcher. It sends the resume through the existing executor. */
	dispatch: (reason: string) => void | Promise<void>;
	/** The clock. It is injected, so the tests are exact. */
	now?: () => number;
	/** The timer that starts a resume. */
	setTimeout?: (callback: () => void, delayMs: number) => unknown;
	/** The timer that stops a resume. */
	clearTimeout?: (handle: unknown) => void;
	/** The reset evidence of the provider, when the harness observed one. */
	resetEvidence?: (failure: ProviderFailure) => RecoveryResetEvidence | undefined;
	/** The number of attempts the cycle allows. */
	maxAttempts: number;
	/** The wait of the overload executor, in milliseconds. */
	overloadDelayMs?: () => number;
	/** The number of attempts the overload executor allows. */
	overloadMaxAttempts?: number;
	/** The log of the runtime. */
	log?: (message: string) => void;
}

/**
 * The runtime of the automatic resumes after a provider failure.
 */
export class ProviderRecoveryRuntime {
	private readonly options: ProviderRecoveryRuntimeOptions;
	private readonly now: () => number;
	private readonly setTimer: (callback: () => void, delayMs: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	/** The failure that waits for the settled boundary. */
	private candidate: ProviderFailureCandidate | null = null;
	/** The timer of the pending attempt of the cycle. */
	private recoveryTimer: unknown = null;
	/** The timer of the pending overload resume. */
	private overloadTimer: unknown = null;
	/** The number of the overload resumes that ran. */
	private overloadAttempts = 0;

	constructor(options: ProviderRecoveryRuntimeOptions) {
		this.options = options;
		this.now = options.now ?? (() => Date.now());
		this.setTimer =
			options.setTimeout ??
			((callback, delayMs) => setTimeout(callback, delayMs) as unknown);
		this.clearTimer =
			options.clearTimeout ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	}

	/**
	 * Note a failure of a turn.
	 *
	 * The failure is a candidate: the countdown starts when the run
	 * settles, because Pi retries a failed turn internally first.
	 */
	noteFailure(
		failure: ProviderFailure,
		failureKey: string,
		options: {
			provider?: string;
			overloadEligible?: boolean;
			boundedEligible?: boolean;
			piRetryOutcome?: PiRetryOutcome;
		} = {},
	): void {
		this.candidate = {
			failure,
			failureKey,
			provider: (options.provider ?? failure.provider ?? "provider").toLowerCase(),
			overloadEligible: options.overloadEligible === true,
			boundedEligible: options.boundedEligible === true,
			piRetryOutcome: options.piRetryOutcome,
		};
	}

	/**
	 * The run settled.
	 *
	 * The internal retries of Pi are over, so the failure is final. The
	 * recovery starts now, and its deadline is measured from this moment.
	 */
	noteSettled(): void {
		const candidate = this.candidate;
		this.candidate = null;
		if (!candidate) return;

		if (candidate.piRetryOutcome === "cancelled") {
			// Pi would retry this failure and made fewer attempts than its
			// budget allows: the delay of the retry was cancelled, and the
			// user decided that. An automatic resume would fight that
			// decision.
			this.log(
				`Pi's internal retry was cancelled: no recovery for ${candidate.failure.kind}`,
			);
			return;
		}

		if (candidate.overloadEligible) {
			this.startOverloadResume();
			return;
		}
		if (!candidate.boundedEligible) {
			// The failure has no executor: the classification says that no
			// automatic retry can fix it. Nothing is scheduled.
			this.log(
				`Provider failure has no automatic executor: ${candidate.failure.kind}`,
			);
			return;
		}
		this.startRecovery(candidate);
	}

	/**
	 * A successful turn ends the cycle and clears the blocked row.
	 */
	noteSuccess(provider: string | undefined): void {
		this.cancelPending();
		// The provider works again: the counter of the overload resumes
		// starts at zero, so the next overload gets the full budget.
		this.overloadAttempts = 0;
		// The cycle is keyed by the provider, so a turn without a known
		// provider ends no cycle. It still ends the pending resumes above.
		const known =
			typeof provider === "string" && provider.trim().length > 0;
		if (known) {
			this.options.controller.noteSuccess({
				sessionId: this.options.context().sessionId,
				provider: provider.toLowerCase(),
			});
		}
		this.options.actions.removeWhere(
			(action) => action.owner === "provider" && action.state === "blocked",
		);
	}

	/**
	 * A user intervention cancels the pending resumes.
	 *
	 * A resume that runs after the user took over is a resume that
	 * overrides the decision of the user.
	 */
	cancel(): void {
		this.cancelPending();
	}

	/**
	 * Cancel the pending resumes without touching the cycle.
	 *
	 * The cycle keeps its budget: a cancelled attempt is not an attempt of
	 * the budget, but the failure that caused it is still the failure of
	 * the cycle.
	 */
	cancelPending(): void {
		this.candidate = null;
		this.cancelRecoveryAttempt();
		this.cancelOverloadResume();
	}

	/**
	 * The session ended: every pending resume dies with it.
	 */
	reset(): void {
		this.cancel();
		this.overloadAttempts = 0;
		this.options.controller.clear();
	}

	/**
	 * Whether a resume of the cycle is pending.
	 */
	get hasPendingRecovery(): boolean {
		return this.recoveryTimer !== null;
	}

	/**
	 * Whether an overload resume is pending.
	 */
	get hasPendingOverload(): boolean {
		return this.overloadTimer !== null;
	}

	/**
	 * The number of the overload resumes that ran.
	 *
	 * The executor of the overload asks the runtime before it schedules
	 * another one: the limit of the executor and the count of the runtime
	 * are the same number.
	 */
	get overloadAttemptCount(): number {
		return this.overloadAttempts;
	}

	/**
	 * Start the cycle of a failure.
	 */
	private startRecovery(candidate: ProviderFailureCandidate): void {
		const { failure, failureKey, provider } = candidate;
		const sessionId = this.options.context().sessionId;
		const outcome = this.options.controller.noteFailure(
			{
				failureKey,
				sessionId,
				provider,
				kind: failure.kind,
				...(failure.window ? { window: failure.window } : {}),
				...(failure.retryAfterMs !== undefined
					? { retryAfterAt: this.now() + failure.retryAfterMs }
					: {}),
			},
			this.options.resetEvidence?.(failure),
		);

		if (outcome.outcome === "scheduled") {
			this.log(
				`Provider recovery attempt ${outcome.attempt}/${this.maxAttempts} at ${new Date(outcome.dueAt).toISOString()} (bound=${outcome.boundBy})`,
			);
			this.scheduleAttempt(outcome.dueAt, outcome.attempt, failure, sessionId);
			return;
		}

		if (outcome.outcome === "blocked") {
			this.log(
				`Provider recovery exhausted after ${outcome.attempt} attempts`,
			);
			this.registerBlocked(failure, outcome.attempt);
			return;
		}

		this.log(
			`Provider recovery unchanged (${outcome.outcome}), attempt ${outcome.attempt}`,
		);
	}

	/**
	 * The number of attempts the cycle allows.
	 */
	private get maxAttempts(): number {
		return this.options.maxAttempts;
	}

	/**
	 * Register the row of a blocked provider.
	 */
	private registerBlocked(failure: ProviderFailure, attempt: number): void {
		const action: PendingAction = {
			id: this.options.blockedActionId,
			sessionId: this.options.context().sessionId,
			owner: "provider",
			kind: "retry",
			state: "blocked",
			...(failure.provider ? { provider: failure.provider } : {}),
			...(failure.code ? { code: failure.code } : {}),
			reason: `recovery attempts exhausted (${attempt}/${this.maxAttempts})`,
		};
		this.options.actions.register(action);
	}

	/**
	 * Start the timer of an attempt of the cycle.
	 */
	private scheduleAttempt(
		dueAt: number,
		attempt: number,
		failure: ProviderFailure,
		sessionId: string,
	): void {
		this.cancelRecoveryAttempt();
		this.options.actions.register({
			id: this.options.recoveryActionId,
			sessionId,
			owner: "provider-recovery",
			kind: "retry",
			state: "scheduled",
			dueAt,
			attempt,
			maxAttempts: this.maxAttempts,
			...(failure.provider ? { provider: failure.provider } : {}),
			...(failure.code ? { code: failure.code } : {}),
			reason: failure.reason,
		});
		const delayMs = Math.max(0, dueAt - this.now());
		this.recoveryTimer = this.setTimer(() => {
			this.recoveryTimer = null;
			// The row leaves when the attempt runs: a countdown must not stay
			// at 00:00.
			this.options.actions.remove(this.options.recoveryActionId);
			this.dispatchIfOwned(sessionId, "provider-recovery");
		}, delayMs);
	}

	/**
	 * Start the timer of the overload resume.
	 */
	private startOverloadResume(): void {
		const limit = this.options.overloadMaxAttempts ?? 3;
		if (this.overloadAttempts >= limit) {
			this.log(
				`Provider overload resume not scheduled: ${this.overloadAttempts}/${limit} attempts used`,
			);
			return;
		}
		this.cancelOverloadResume();
		this.overloadAttempts += 1;
		const delayMs = this.options.overloadDelayMs?.() ?? 60_000;
		const sessionId = this.options.context().sessionId;
		this.options.actions.register({
			id: this.options.overloadActionId,
			sessionId,
			owner: "provider-overload",
			kind: "retry",
			state: "scheduled",
			dueAt: this.now() + delayMs,
			attempt: this.overloadAttempts,
			reason: "the provider is overloaded",
		});
		this.overloadTimer = this.setTimer(() => {
			this.overloadTimer = null;
			this.options.actions.remove(this.options.overloadActionId);
			this.dispatchIfOwned(sessionId, "provider-overload");
		}, delayMs);
	}

	/**
	 * Cancel the pending attempt of the cycle.
	 */
	private cancelRecoveryAttempt(): void {
		if (this.recoveryTimer !== null) {
			this.clearTimer(this.recoveryTimer);
			this.recoveryTimer = null;
		}
		this.options.actions.remove(this.options.recoveryActionId);
	}

	/**
	 * Cancel the pending overload resume.
	 */
	private cancelOverloadResume(): void {
		if (this.overloadTimer !== null) {
			this.clearTimer(this.overloadTimer);
			this.overloadTimer = null;
		}
		this.options.actions.remove(this.options.overloadActionId);
	}

	/**
	 * Dispatch a resume, but only while it still owns the session.
	 *
	 * The ownership is checked at the moment of the dispatch, not at the
	 * moment of the scheduling: the user may pause the work while the
	 * countdown runs.
	 */
	private dispatchIfOwned(sessionId: string, reason: string): void {
		const decision = mayDispatchResume({
			scheduledSessionId: sessionId,
			current: this.options.context(),
		});
		if (decision.allowed === false) {
			this.log(`Resume skipped (${reason}): ${decision.reason}`);
			return;
		}
		void this.options.dispatch(reason);
	}

	/**
	 * Write to the log of the runtime.
	 */
	private log(message: string): void {
		this.options.log?.(message);
	}
}

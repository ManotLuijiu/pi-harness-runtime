/**
 * The runtime of the guard of a repeated output.
 *
 * The pure parts of the guard live in `harness/repetition-guard.ts`. This
 * runtime binds them to the session:
 *
 * - the deltas of the stream are examined once, as they arrive,
 * - the run is stopped when the repetition is found, and the state is
 *   marked before it happens, so the harness knows that the guard stopped
 *   the run and not the human,
 * - the tail of the noise is kept out of the next context of the model,
 * - the run gets one bounded recovery, and a second repetition is
 *   reported instead of retried.
 *
 * The runtime never authorises anything: it never commits, never pushes,
 * never builds and never answers a question of the human. It stops a run
 * that is not working, and it asks the agent to continue from the work it
 * has.
 */

import {
	GenerationLoopGuard,
	type ContextMessage,
	type GenerationLoopState,
	RepetitionDetector,
	contextWithoutRepetitiveTail,
} from "./repetition-guard.ts";

/**
 * The identity of the run that repeats itself.
 */
export interface RepetitionIdentity {
	/** The session the run belongs to. */
	sessionId: () => string;
	/** The generation of the request the run belongs to. */
	requestGeneration: () => number;
}

/**
 * What the runtime is allowed to do.
 */
export interface RepetitionGuardRuntimeOptions {
	/** The identity of the run. */
	identity: RepetitionIdentity;
}

/**
 * The runtime of the guard.
 */
export class RepetitionGuardRuntime {
	private readonly detector = new RepetitionDetector();
	private readonly guard = new GenerationLoopGuard();
	private readonly options: RepetitionGuardRuntimeOptions;
	/** The run that repeats itself is stopped by the guard. */
	private interrupted = false;
	/**
	 * The guard stopped a run.
	 *
	 * The fact is sticky until it is read: the abort of the run that
	 * repeated itself can arrive after the start of a message that Pi
	 * queued, and the stop of the guard must still be told apart from the
	 * stop of the human. The fact is taken by the boundary of the run that
	 * reads it, so the next run does not inherit it.
	 */
	private stopped = false;
	/**
	 * The repetition of the run that is alive now.
	 *
	 * The marked state of the guard outlives the run that repeats itself:
	 * the noise of that run stays out of the context of the next run. The
	 * live state is the repetition of the run that is going: it is not
	 * cleared by the start of the next message (a continuation that Pi
	 * queued starts before the run settles, and it must not swallow the
	 * recovery), it is consumed by the decision.
	 */
	private live: GenerationLoopState | undefined;

	constructor(options: RepetitionGuardRuntimeOptions) {
		this.options = options;
	}

	/**
	 * The state of the run, if it repeats itself.
	 *
	 * Only the live repetition counts: a run that recovered and answered
	 * normally does not repeat itself.
	 */
	state(): GenerationLoopState | undefined {
		return this.live;
	}

	/**
	 * Take the repetition of the run that is going.
	 *
	 * The state is consumed: the decision sees it once. A run that repeats
	 * itself again after its recovery marks a new live state, and the
	 * decision of that run sees it.
	 */
	takeState(): GenerationLoopState | undefined {
		const state = this.live;
		this.live = undefined;
		return state;
	}

	/**
	 * Is the run that repeats itself stopped by the guard?
	 *
	 * The stop of the guard is not the stop of the human: a recovery is
	 * allowed after the guard stopped a run, and it is not allowed after
	 * the human stopped it.
	 */
	stoppedByGuard(): boolean {
		return this.stopped;
	}

	/**
	 * Take the fact that the guard stopped a run.
	 *
	 * The fact is taken by the boundary of the run: the next run of the
	 * model does not inherit it, and a human that stops that run is not
	 * mistaken for the guard.
	 */
	takeStoppedByGuard(): boolean {
		const stopped = this.stopped;
		this.stopped = false;
		return stopped;
	}

	/**
	 * Examine a delta of the stream.
	 *
	 * The finding is returned when the repetition was found. The state is
	 * marked before the run is stopped, so the stop of the guard is never
	 * mistaken for the stop of the human.
	 */
	observeDelta(
		delta: string,
		interrupt?: (state: GenerationLoopState) => void,
	): GenerationLoopState | undefined {
		if (this.interrupted) return undefined;
		const finding = this.detector.push(delta);
		if (!finding) return undefined;
		const state = this.guard.mark({
			sessionId: this.options.identity.sessionId(),
			requestGeneration: this.options.identity.requestGeneration(),
			finding,
		});
		this.interrupted = true;
		this.live = state;
		// The fact of the stop is recorded only when the guard had the
		// means to stop the run: a repetition that was found without an
		// abort never stopped anything, and the fact would tell a human
		// stop of a later run for the stop of the guard.
		if (interrupt) {
			this.stopped = true;
			interrupt(state);
		}
		return state;
	}

	/**
	 * The messages of a context without the tail of the noise.
	 *
	 * The transcript of the session keeps the noise; the context of the
	 * next model call does not.
	 */
	quarantine(messages: ContextMessage[]): ContextMessage[] {
		// The findings of another session are not the findings of this one:
		// the transcript of the new session does not carry the noise of the
		// old one.
		const sessionId = this.options.identity.sessionId();
		// The finding of the run that is alive belongs to that run: the
		// session can be replaced while the run goes on, and the noise of
		// that run still belongs out of the context.
		const liveSessionId = this.live?.sessionId;
		const findings = this.guard
			.findingsOf()
			.filter(
				(entry) =>
					entry.sessionId === sessionId || entry.sessionId === liveSessionId,
			)
			.map((entry) => entry.finding);
		if (findings.length === 0) return messages;
		// Every finding is applied: a run that repeated itself twice has
		// two noises, and the noise of the first one belongs out of the
		// context as well.
		let result = messages;
		for (const finding of findings) {
			result = contextWithoutRepetitiveTail(result, finding);
		}
		return result;
	}

	/**
	 * Claim the one recovery of the run.
	 *
	 * The claim survives a new repetition: a run that repeats itself again
	 * after its recovery is not recovered a second time.
	 */
	claimRecovery(): boolean {
		return this.guard.claimRecovery();
	}

	/**
	 * Was the recovery of the run already tried?
	 *
	 * The gate of the recovery asks this before it claims the recovery: a
	 * repetition that comes back after the recovery is blocked, and the
	 * block is reported with its reason.
	 */
	recoveryTried(): boolean {
		return this.guard.current()?.recovered === true;
	}

	/**
	 * The stream of a new message begins.
	 *
	 * A new message is a new run of the model: the tail of the stream is
	 * clean and the guard may fire again. The claim of the recovery
	 * survives: a repetition that comes back after its recovery is not
	 * recovered a second time.
	 */
	newMessage(): void {
		this.detector.reset();
		this.interrupted = false;
	}

	/**
	 * Forget the run.
	 *
	 * A new request is a new run: the state of the old run does not
	 * belong to it. The findings stay: the noise of the old run is still
	 * in the transcript of the session, and it belongs out of the context
	 * of the next call of the model as well.
	 */
	resetRun(): void {
		this.guard.resetRun();
		this.interrupted = false;
		this.stopped = false;
		this.live = undefined;
		this.detector.reset();
	}

	/**
	 * Forget everything.
	 *
	 * A new session has a new transcript: the noise of the old session is
	 * not in it.
	 */
	reset(): void {
		this.guard.reset();
		this.interrupted = false;
		this.stopped = false;
		this.live = undefined;
		this.detector.reset();
	}
}

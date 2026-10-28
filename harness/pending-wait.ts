/**
 * The end of a wait for a pending question.
 *
 * The countdown, the wait state and the pending question belong together:
 * when one of them ends, the others end with it. A wait that outlives its
 * question lets the judge decide about a question that belongs to a session
 * that is gone - the fallback poll would ask about a question nobody can
 * answer any more.
 *
 * The helper owns that release, so every way out of a wait ends the same
 * way.
 */

/**
 * The pieces of the wait that a release touches.
 */
export interface WaitRelease {
	/**
	 * Clear the wait state.
	 *
	 * The state is the moment the wait began and the marker of the
	 * question that was notified. Both belong to the wait: a question that
	 * is closed must not keep the harness from noticing it again.
	 */
	clearWaitState(): void;
	/** Stop the countdown of the wait and release its timer. */
	stopCountdown(): void;
}

/**
 * Release a wait.
 *
 * The state and the countdown of the wait die together: a live countdown
 * without a wait draws a row for a question that is not waiting any more,
 * and a wait without a stopped countdown leaves a tick that can fire for a
 * question that is gone.
 */
export function releaseWait(release: WaitRelease): void {
	release.clearWaitState();
	release.stopCountdown();
}

/** The question that is waiting for an answer. */
export interface PendingWaitQuestion {
	requestId: string;
	state: string;
}

/** The pieces of the harness that the release of a wait touches. */
export interface PendingWaitOwner extends WaitRelease {
	/** The question that is waiting for an answer, if there is one. */
	currentQuestion(): PendingWaitQuestion | null | undefined;
	/**
	 * Close the question.
	 *
	 * Returns true when the question was closed. A question that is not
	 * pending any more needs no closing.
	 */
	expireQuestion(requestId: string, reason: string): boolean;
	/** Clear the status row of the wait. */
	clearStatus(): void;
	/** Record the transition of the question. */
	logTransition(requestId: string, outcome: string, reason: string): void;
}

/**
 * End the wait for a pending question.
 *
 * The question is closed first, so nothing can decide about it any more,
 * and the wait state follows. The reason names the way out, so the log of
 * the transition says why the question was closed.
 */
export function endPendingWait(reason: string, owner: PendingWaitOwner): void {
	// The question is closed before the wait is cleared: nothing can
	// decide about it in between.
	const question = owner.currentQuestion();
	if (question && question.state === "pending") {
		const expired = owner.expireQuestion(question.requestId, reason) === true;
		owner.logTransition(
			question.requestId,
			expired ? "expired" : "closed",
			reason,
		);
	}

	// The wait and the countdown of the wait die together.
	releaseWait(owner);
	owner.clearStatus();
}

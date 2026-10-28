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

/** The question that is waiting for an answer. */
export interface PendingWaitQuestion {
	requestId: string;
	state: string;
}

/** The pieces of the harness that the release of a wait touches. */
export interface PendingWaitOwner {
	/** The question that is waiting for an answer, if there is one. */
	currentQuestion(): PendingWaitQuestion | null | undefined;
	/**
	 * Close the question.
	 *
	 * Returns true when the question was closed. A question that is not
	 * pending any more needs no closing.
	 */
	expireQuestion(requestId: string, reason: string): boolean;
	/** Clear the wait state: the wait is over. */
	clearWait(): void;
	/** Stop the countdown of the wait and release its timer. */
	stopCountdown(): void;
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
	// The countdown of the question is over with the wait: a tick of it
	// must not draw a status and must not start a decision.
	owner.stopCountdown();

	// The question is closed explicitly, so the buttons of that request do
	// not stay open and look like a request that is still waiting.
	const question = owner.currentQuestion();
	if (question && question.state === "pending") {
		const expired = owner.expireQuestion(question.requestId, reason) === true;
		owner.logTransition(
			question.requestId,
			expired ? "expired" : "closed",
			reason,
		);
	}

	// The wait state is over with the question: the judge is not asked
	// about a question of a session that is gone.
	owner.clearWait();
	owner.clearStatus();
}

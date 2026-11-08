/**
 * The state of a question that waits for an answer.
 *
 * The runtime asks two questions about an open question, and both have the
 * same answer: "is there still a question that waits for an answer?"
 *
 *  - a reply of the user closes it, so its buttons cannot inject a second
 *    answer into a question that is done,
 *  - the work does not continue behind it, no matter why the wait is over.
 *
 * The rules live here, so the two places in the runtime cannot disagree.
 */

/** The part of a pending question the rules need. */
export interface QuestionStateLike {
	/** The state of the question ("pending", "evaluating", ...). */
	state: string;
}

/**
 * Is the question still waiting for an answer?
 *
 * A question that was answered, cancelled or expired is closed: its buttons
 * are stale and it blocks nothing.
 */
export function isQuestionOpen(
	question: QuestionStateLike | null | undefined,
): boolean {
	if (!question) return false;
	return question.state === "pending" || question.state === "evaluating";
}

/**
 * May the work continue?
 *
 * A question that waits for an answer blocks the work - also when the wait
 * itself is over: Jev asked a human, or the evaluation of the question
 * failed. The question is the thing that needs an answer, so it blocks until
 * it is answered or cancelled.
 */
export function mayContinue(options: {
	/** Is the wait of the question still running? */
	waiting: boolean;
	/** Is the question still open? */
	questionOpen: boolean;
}): boolean {
	return !(options.waiting || options.questionOpen);
}

/**
 * What a reply of the user does to the wait and to the question.
 *
 *  - `cancelled-wait-and-question`: the wait was running. The reply ends the
 *    wait and closes the question.
 *  - `cancelled-question`: the wait was over, but the question was still
 *    open. The reply closes the question. The work that was paused for the
 *    answer continues, because the human is here.
 *  - `none`: there is nothing to close.
 */
export type UserReplyEffect =
	| "cancelled-wait-and-question"
	| "cancelled-question"
	| "none";

export function userReplyEffect(options: {
	/** Is the wait of the question still running? */
	waiting: boolean;
	/** Is the question still open? */
	questionOpen: boolean;
}): UserReplyEffect {
	if (options.waiting) return "cancelled-wait-and-question";
	if (options.questionOpen) return "cancelled-question";
	return "none";
}

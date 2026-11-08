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
 * The wordings that decline a proposal.
 *
 * A decline is a directive to the harness, so it is recognized at the start
 * of the reply: "No, do not implement it", "No thanks", "Never mind",
 * "Cancel that". A negation in the middle of a sentence ("there is no error
 * in the log") is a statement, not a decline.
 *
 * A decline names an action. A negative statement about a state ("I don't
 * see any errors") declines nothing, so it must not pause the work.
 */
const REJECTION_PATTERNS: RegExp[] = [
	// "No", "No, do not implement it", "Nope", "No thanks"
	/^(?:no|nope|nah)\b\s*(?:[,.!]|$|thanks\b|thank\s+you\b)/i,
	// "Never mind", "Cancel that", "Abort", "Reject"
	/^(?:never\s*mind|nevermind|cancel|abort|reject)\b/i,
	// "Do not implement it", "Don't do it", "Never do that"
	/^(?:do\s*not|don't|dont|never)\s+\S/i,
	// "I do not want that", "I won't do it", "I will not do that".
	// The object of the decline has to be the action: "I don't see any
	// errors" declines nothing, it is a statement about a state.
	/^i\s+(?:do\s*not|don't|dont|won't|will\s+not|never)\s+(?:want|need|wish|like|do|apply|proceed|continue|run|implement|merge|deploy|publish|send|make|execute|perform)\b/i,
	// a directive about the work, anywhere in the reply
	/\b(?:do\s*not|don't|dont)\s+(?:implement|do|apply|proceed|continue|run|merge|deploy|publish|make|perform|execute|send|delete)\b/i,
];

/**
 * Does the reply decline the proposal?
 *
 * A decline is a decision about the proposal: the work must not continue
 * behind it. The wording of a decline is a directive to the harness, so it
 * is recognized at the start of the reply - a mention of a negation in the
 * middle of a sentence is not a decline.
 *
 * The decline names an action. A negative statement about a state ("I don't
 * see any errors") is not a decline.
 */
export function isRejection(text: string | undefined): boolean {
	const reply = (text ?? "").trim();
	if (reply.length === 0) return false;
	return REJECTION_PATTERNS.some((pattern) => pattern.test(reply));
}

/**
 * What a reply of the user does to the wait and to the question.
 *
 *  - `cancelled-wait-and-question`: the wait was running. The reply ends the
 *    wait and closes the question.
 *  - `cancelled-question`: the wait was over, but the question was still
 *    open. The reply closes the question.
 *  - `none`: there is nothing to close.
 *
 * Closing the question is not an authorization: the reply says that the
 * question is answered, not that the work may continue. The work that waits
 * for an answer stays paused until it is resumed explicitly - a decline has
 * to retain the pause, and an acknowledgment ("okay", "yes") never clears
 * it.
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
